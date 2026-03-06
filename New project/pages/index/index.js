const { TENCENT_MAP_KEY } = require("../../config");

const SPOTS = [
  {
    id: "spot1",
    name: "古城墙",
    type: "历史文化",
    recommendedStayMin: 120,
    lat: 34.2655,
    lng: 108.9531
  },
  {
    id: "spot2",
    name: "城市博物馆",
    type: "人文展览",
    recommendedStayMin: 90,
    lat: 34.2554,
    lng: 108.947
  },
  {
    id: "spot3",
    name: "湖滨公园",
    type: "自然风景",
    recommendedStayMin: 60,
    lat: 34.243,
    lng: 108.9382
  },
  {
    id: "spot4",
    name: "夜市步行街",
    type: "美食购物",
    recommendedStayMin: 150,
    lat: 34.2612,
    lng: 108.9386
  },
  {
    id: "spot5",
    name: "山顶观景台",
    type: "城市观景",
    recommendedStayMin: 80,
    lat: 34.2316,
    lng: 108.977
  }
];

const FOODS = [
  { id: "food1", name: "牛肉汤", area: "老城区" },
  { id: "food2", name: "手工米粉", area: "博物馆附近" },
  { id: "food3", name: "烤串拼盘", area: "夜市步行街" },
  { id: "food4", name: "糖油糕", area: "湖滨公园口" }
];

const DISTANCE_KM = {
  "spot1-spot2": 3.2,
  "spot1-spot3": 5.1,
  "spot1-spot4": 4.3,
  "spot1-spot5": 8.5,
  "spot2-spot3": 2.4,
  "spot2-spot4": 3.8,
  "spot2-spot5": 7.2,
  "spot3-spot4": 2.9,
  "spot3-spot5": 6.8,
  "spot4-spot5": 9.1
};

function buildDistanceKey(idA, idB) {
  return [idA, idB].sort().join("-");
}

function estimateTransport(distanceKm) {
  if (distanceKm <= 2) {
    return { mode: "步行", durationMin: Math.ceil((distanceKm / 4.5) * 60), source: "估算" };
  }
  if (distanceKm <= 6) {
    return { mode: "打车", durationMin: Math.ceil((distanceKm / 25) * 60 + 6), source: "估算" };
  }
  return { mode: "地铁/公交", durationMin: Math.ceil((distanceKm / 22) * 60 + 10), source: "估算" };
}

function requestTencentDirection(url, from, to) {
  return new Promise((resolve) => {
    wx.request({
      url,
      data: {
        from: `${from.lat},${from.lng}`,
        to: `${to.lat},${to.lng}`,
        key: TENCENT_MAP_KEY
      },
      success: (res) => {
        if (!res || !res.data || res.data.status !== 0) {
          resolve(null);
          return;
        }

        const route =
          res.data.result && res.data.result.routes && res.data.result.routes.length > 0
            ? res.data.result.routes[0]
            : null;
        if (!route) {
          resolve(null);
          return;
        }

        resolve({
          durationMin: Math.max(1, Math.ceil((route.duration || 0) / 60)),
          distanceKm: Number(((route.distance || 0) / 1000).toFixed(1))
        });
      },
      fail: () => resolve(null)
    });
  });
}

async function fetchRealTransport(fromSpot, toSpot) {
  if (!TENCENT_MAP_KEY) {
    return null;
  }

  const base = "https://apis.map.qq.com/ws/direction/v1";
  const walking = await requestTencentDirection(`${base}/walking`, fromSpot, toSpot);
  if (walking && walking.distanceKm <= 2) {
    return {
      mode: "步行",
      durationMin: walking.durationMin,
      distanceKm: walking.distanceKm,
      source: "腾讯地图"
    };
  }

  const driving = await requestTencentDirection(`${base}/driving`, fromSpot, toSpot);
  if (driving) {
    return {
      mode: "驾车",
      durationMin: driving.durationMin,
      distanceKm: driving.distanceKm,
      source: "腾讯地图"
    };
  }

  if (walking) {
    return {
      mode: "步行",
      durationMin: walking.durationMin,
      distanceKm: walking.distanceKm,
      source: "腾讯地图"
    };
  }

  return null;
}

Page({
  data: {
    spots: SPOTS,
    foods: FOODS,
    planIds: [],
    planView: [],
    summary: {
      totalStayMin: 0,
      totalTravelMin: 0,
      totalDayMin: 0
    }
  },

  onLoad() {
    this.planBuildToken = 0;
  },

  addSpotToPlan(event) {
    const { id } = event.currentTarget.dataset;
    const { planIds } = this.data;
    if (planIds.includes(id)) {
      wx.showToast({
        title: "该景点已在日程中",
        icon: "none"
      });
      return;
    }

    const nextPlanIds = [...planIds, id];
    this.updatePlan(nextPlanIds);
    wx.showToast({
      title: "已加入日程",
      icon: "success"
    });
  },

  async updatePlan(planIds) {
    const currentToken = Date.now();
    this.planBuildToken = currentToken;

    const planSpots = planIds
      .map((spotId) => SPOTS.find((spot) => spot.id === spotId))
      .filter(Boolean);

    let totalStayMin = 0;
    let totalTravelMin = 0;
    const planView = [];

    for (let index = 0; index < planSpots.length; index += 1) {
      const spot = planSpots[index];
      totalStayMin += spot.recommendedStayMin;

      if (index === 0) {
        planView.push({
          ...spot,
          transportFromPrev: null
        });
        continue;
      }

      const prev = planSpots[index - 1];
      const realTransport = await fetchRealTransport(prev, spot);
      const distanceKey = buildDistanceKey(prev.id, spot.id);
      const fallbackDistance = DISTANCE_KM[distanceKey] || 4;
      const fallbackTransport = estimateTransport(fallbackDistance);
      const finalTransport = realTransport || {
        ...fallbackTransport,
        distanceKm: fallbackDistance
      };

      totalTravelMin += finalTransport.durationMin;
      planView.push({
        ...spot,
        transportFromPrev: finalTransport
      });
    }

    if (this.planBuildToken !== currentToken) {
      return;
    }

    this.setData({
      planIds,
      planView,
      summary: {
        totalStayMin,
        totalTravelMin,
        totalDayMin: totalStayMin + totalTravelMin
      }
    });
  }
});
