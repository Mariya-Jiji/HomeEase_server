const router = require('express').Router();
const User = require('../models/User');
const Booking = require('../models/Booking');

// Get providers by service type (with location + distance sorting)
router.get('/:serviceType', async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;
    const serviceType = req.params.serviceType;

    const query = {
      role: 'provider',
      status: 'approved',
      serviceType: serviceType
    };

    let providers = await User.find(query)
      .select('-password')
      .lean();

    // 🔴 Remove busy providers
    const activeBookings = await Booking.find({ status: 'accepted' }).select('provider');
    const busyProviderIds = activeBookings.map(b => b.provider.toString());

    providers = providers.filter(provider =>
      !busyProviderIds.includes(provider._id.toString())
    );

    // 🔥 DISTANCE LOGIC
    if (lat && lng) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      const maxRadius = parseFloat(radius) || 50; // km

      providers = providers.map(provider => {
        if (!provider.location || !provider.location.coordinates) {
          provider.distanceKm = null;
          return provider;
        }

        const [providerLng, providerLat] = provider.location.coordinates;

        const dist = getDistanceKm(
          userLat,
          userLng,
          providerLat,
          providerLng
        );

        provider.distanceKm = parseFloat(dist.toFixed(1));
        return provider;
      });

      // Filter by radius
      providers = providers.filter(p =>
        p.distanceKm === null || p.distanceKm <= maxRadius
      );

      // Sort by distance
      providers.sort((a, b) => (a.distanceKm || 9999) - (b.distanceKm || 9999));
    } else {
      // fallback sort
      providers.sort((a, b) => b.rating - a.rating);
    }

    res.json(providers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: err.message });
  }
});

// 📏 Distance function
function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

module.exports = router;