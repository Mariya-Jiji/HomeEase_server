const router = require('express').Router();
const Booking = require('../models/Booking');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Create booking\nrouter.post('/', auth, async (req, res) => {\n  try {\n    const user = await User.findById(req.user.id);\n    if (user.role === 'customer' && user.finePending) {\n      return res.status(403).json({ msg: 'Cannot create new bookings. You have pending fine payment confirmation from provider(s).' });\n    }\n    \n    const booking = new Booking({ ...req.body, customer: req.user.id });\n    await booking.save();\n    \n    // Notify provider of new booking request\n    const populatedBooking = booking.populate('provider customer');\n    const provider = await User.findById(req.body.provider);\n    if (provider) {\n      provider.notifications.push({ \n        message: `New booking request from ${req.body.customerName} for ${req.body.serviceType.replace('_', ' ')} on ${req.body.date}.`, \n        read: false \n      });\n      await provider.save();\n    }\n    \n    res.json(booking);\n  } catch (err) {\n    res.status(500).json({ msg: err.message });\n  }\n});

// Get bookings for customer
router.get('/customer', auth, async (req, res) => {
  try {
    const bookings = await Booking.find({ customer: req.user.id }).populate('provider', 'name phone').sort({ createdAt: -1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Get bookings for provider
router.get('/provider', auth, async (req, res) => {
  try {
    const bookings = await Booking.find({ provider: req.user.id }).populate('customer', 'name phone').sort({ createdAt: -1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Update booking status (supports workDescription + amount for 'completed')
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status, workDescription, amount } = req.body;
    const update = { status };
    if (workDescription) update.workDescription = workDescription;
    if (amount) update.amount = amount;
    const booking = await Booking.findByIdAndUpdate(req.params.id, update, { new: true });
    
    // Add notifications
    const populatedBooking = await Booking.findById(req.params.id).populate('customer provider');
    const customer = populatedBooking.customer;
    const provider = populatedBooking.provider;
    
    if (status === 'accepted') {
      customer.notifications.push({ message: `Your booking for ${booking.serviceType.replace('_', ' ')} on ${booking.date} has been accepted by ${provider.name}!`, read: false });
      await customer.save();
    } else if (status === 'completed') {
      customer.notifications.push({ message: `Provider ${provider.name} has completed the work for your booking. Please initiate payment.`, read: false });
      await customer.save();
    }
    
    res.json(booking);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Customer initiates payment
router.put('/:id/payment', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    
    // Verify that the authenticated user is the customer
    if (booking.customer.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Only the customer can initiate payment.' });
    }
    
    
    
    // Update with payment method - sets paymentInitiated flag
    const updatedBooking = await Booking.findByIdAndUpdate(
      req.params.id,
      { paymentMethod: req.body.paymentMethod, status: 'payment_initiated' },
      { new: true }
    );
    
    // Notify provider
    const populatedBooking = await Booking.findById(req.params.id).populate('provider customer');
    const provider = populatedBooking.provider;
    provider.notifications.push({ message: `Customer ${populatedBooking.customer.name} initiated payment for booking via ${req.body.paymentMethod.toUpperCase()}.`, read: false });
    await provider.save();
    
    res.json(updatedBooking);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Customer confirms payment completed
router.put('/:id/confirm-customer-payment', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    
    // Verify that the authenticated user is the customer
    if (booking.customer.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Only the customer can confirm payment.' });
    }
    
    // Only allow confirmation for payment_initiated bookings
    console.log('Confirm payment attempt - status:', booking.status);
    if (booking.status !== 'payment_initiated') {
      return res.status(400).json({ msg: `Confirm payment only for 'payment_initiated'. Current: ${booking.status}` });
    }
    
    const updatedBooking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status: 'payment_pending' },
      { new: true }
    );
    
    // Notify provider
    const populatedBooking = await Booking.findById(req.params.id).populate('provider customer');
    const provider = populatedBooking.provider;
    provider.notifications.push({ message: `Customer ${populatedBooking.customer.name} has confirmed payment for your booking is completed. Please confirm receipt.`, read: false });
    await provider.save();
    
    res.json(updatedBooking);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Provider confirms payment received
router.put('/:id/confirm-payment', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    
    // Verify that the authenticated user is the provider
    if (booking.provider.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Only the provider can confirm payment.' });
    }
    
    // Only allow confirmation for payment_pending bookings
    if (booking.status !== 'payment_pending') {
      return res.status(400).json({ msg: 'Payment must be initiated by customer first.' });
    }
    
    const updatedBooking = await Booking.findByIdAndUpdate(
      req.params.id,
      { paymentDone: true, status: 'paid' },
      { new: true }
    );
    
    // Notify both
    const populatedBooking = await Booking.findById(req.params.id).populate('customer provider');
    const customer = populatedBooking.customer;
    const provider = populatedBooking.provider;
    customer.notifications.push({ message: `Payment for your booking has been confirmed by provider. Thank you!`, read: false });
    provider.notifications.push({ message: `Payment received and confirmed for ${customer.name}'s booking.`, read: false });
    await customer.save();
    await provider.save();
    
    res.json(updatedBooking);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Customer pays cancellation fee
router.put('/:id/pay-cancellation-fee', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    
    // Verify that the authenticated user is the customer
    if (booking.customer.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Only the customer can pay cancellation fee.' });
    }
    
    // Only allow for cancelled bookings with unpaid fees
    if (booking.status !== 'cancelled' || booking.cancellationFee <= 0 || booking.cancellationFeeConfirmed) {
      return res.status(400).json({ msg: 'Invalid cancellation fee payment request.' });
    }
    
    // For now, just mark as paid (in real app, this would integrate with payment gateway)
    const updatedBooking = await Booking.findByIdAndUpdate(
      req.params.id,
      { cancellationFeeConfirmed: true }, // For simplicity, mark as confirmed immediately
      { new: true }
    );
    res.json(updatedBooking);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Provider confirms cancellation fee received\nrouter.put('/:id/confirm-cancellation-fee', auth, async (req, res) => {\n  try {\n    const booking = await Booking.findById(req.params.id);\n    \n    // Verify that the authenticated user is the provider\n    if (booking.provider.toString() !== req.user.id) {\n      return res.status(403).json({ msg: 'Only the provider can confirm cancellation fee.' });\n    }\n    \n    // Only allow confirmation for cancelled bookings with unpaid fees\n    if (booking.status !== 'cancelled' || booking.cancellationFee <= 0 || booking.cancellationFeeConfirmed) {\n      return res.status(400).json({ msg: 'Invalid cancellation fee confirmation request.' });\n    }\n    \n    const updatedBooking = await Booking.findByIdAndUpdate(\n      req.params.id,\n      { cancellationFeeConfirmed: true },\n      { new: true }\n    );\n    \n    // Check if customer has any other unconfirmed fines. If none, unblock\n    const customer = await User.findById(booking.customer);\n    const pendingFines = await Booking.countDocuments({\n      customer: booking.customer,\n      status: 'cancelled',\n      cancellationFee: { $gt: 0 },\n      cancellationFeeConfirmed: false\n    });\n    \n    if (pendingFines === 0) {\n      customer.finePending = false;\n      await customer.save();\n      // Notify customer\n      customer.notifications.push({\n        message: 'All fine payments confirmed. You can now book new services!',\n        read: false\n      });\n      await customer.save();\n    }\n    \n    res.json(updatedBooking);\n  } catch (err) {\n    res.status(500).json({ msg: err.message });\n  }\n});

// Cancel booking (customer)\nrouter.put('/:id/cancel', auth, async (req, res) => {\n  try {\n    const booking = await Booking.findById(req.params.id);\n    if (!booking) return res.status(404).json({ msg: 'Booking not found' });\n\n    if (booking.customer.toString() !== req.user.id) {\n      return res.status(403).json({ msg: 'Only customer can cancel this booking.' });\n    }\n\n    if (['paid', 'cancelled'].includes(booking.status)) {\n      return res.status(400).json({ msg: 'This booking cannot be cancelled.' });\n    }\n\n    // If provider already started move (shared location while accepted), apply 100rs cancellation fee\n    let cancellationFee = 0;\n    if (booking.status === 'accepted' && (booking.providerCurrentLatitude || booking.providerCurrentLongitude)) {\n      cancellationFee = 100;\n      booking.cancellationFee = 100;\n    }\n\n    booking.status = 'cancelled';\n    await booking.save();\n    \n    // If fine applied, block customer from new bookings\n    if (cancellationFee > 0) {\n      const customer = await User.findById(booking.customer);\n      customer.finePending = true;\n      await customer.save();\n    }\n    \n    // Add notifications for cancel\n    const populatedBooking = await Booking.findById(req.params.id).populate('customer provider');\n    const customer = populatedBooking.customer;\n    const provider = populatedBooking.provider;\n    const feeMsg = cancellationFee > 0 ? ` Cancellation fee of ₹${cancellationFee} applies. You cannot book new services until provider confirms payment.` : '';\n    customer.notifications.push({ message: `Your booking has been cancelled.${feeMsg}`, read: false });\n    if (cancellationFee > 0) {\n      provider.notifications.push({ message: `Booking cancelled by customer. Cancellation fee ₹${cancellationFee} pending payment. Please confirm receipt to unblock customer.`, read: false });\n    }\n    await customer.save();\n    if (cancellationFee > 0) await provider.save();\n\n    const responseBody = {\n      ...booking.toObject(),\n      cancellationFee\n    };\n\n    res.json(responseBody);\n  } catch (err) {\n    res.status(500).json({ msg: err.message });\n  }\n});

// Submit review
router.put('/:id/review', auth, async (req, res) => {
  try {
    const { review, rating } = req.body;
    const booking = await Booking.findByIdAndUpdate(
      req.params.id, { review, rating }, { new: true }
    );
    const allBookings = await Booking.find({ provider: booking.provider, rating: { $exists: true } });
    const avg = allBookings.reduce((a, b) => a + b.rating, 0) / allBookings.length;
    await User.findByIdAndUpdate(booking.provider, { rating: avg, reviewCount: allBookings.length });
    res.json(booking);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Debug endpoint - REMOVE IN PRODUCTION
router.get('/debug', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('bookings');
    const pendingFines = await Booking.countDocuments({
      customer: req.user.id,
      status: 'cancelled',
      cancellationFee: { $gt: 0 },
      cancellationFeeConfirmed: false
    });
    res.json({
      userFinePending: user.finePending,
      pendingFinesCount: pendingFines,
      bookings: await Booking.find({ customer: req.user.id }).select('status cancellationFee cancellationFeeConfirmed'),
      reset: req.query.reset === 'true' ? (user.finePending = false, user.save(), 'RESET') : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
