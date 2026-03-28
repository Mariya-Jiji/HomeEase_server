const router = require('express').Router();
const Booking = require('../models/Booking');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Create booking
router.post('/', auth, async (req, res) => {
  try {
    const booking = new Booking({ ...req.body, customer: req.user.id });
    await booking.save();
    
    // Notify provider of new booking request
    const populatedBooking = booking.populate('provider customer');
    const provider = await User.findById(req.body.provider);
    if (provider) {
      provider.notifications.push({ 
        message: `New booking request from ${req.body.customerName} for ${req.body.serviceType.replace('_', ' ')} on ${req.body.date}.`, 
        read: false 
      });
      await provider.save();
    }
    
    res.json(booking);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

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
    
    // Only allow payment for completed bookings
    console.log('Payment attempt - current status:', booking.status);
    if (booking.status !== 'completed') {
      return res.status(400).json({ msg: `Payment only allowed for 'completed' status. Current: ${booking.status}` });
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
    if (booking.status !== 'payment_initiated') {
      return res.status(400).json({ msg: 'Payment must be initiated first.' });
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

// Provider confirms cancellation fee received
router.put('/:id/confirm-cancellation-fee', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    
    // Verify that the authenticated user is the provider
    if (booking.provider.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Only the provider can confirm cancellation fee.' });
    }
    
    // Only allow confirmation for cancelled bookings with unpaid fees
    if (booking.status !== 'cancelled' || booking.cancellationFee <= 0 || booking.cancellationFeeConfirmed) {
      return res.status(400).json({ msg: 'Invalid cancellation fee confirmation request.' });
    }
    
    const updatedBooking = await Booking.findByIdAndUpdate(
      req.params.id,
      { cancellationFeeConfirmed: true },
      { new: true }
    );
    res.json(updatedBooking);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Cancel booking (customer)
router.put('/:id/cancel', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ msg: 'Booking not found' });

    if (booking.customer.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Only customer can cancel this booking.' });
    }

    if (['paid', 'cancelled'].includes(booking.status)) {
      return res.status(400).json({ msg: 'This booking cannot be cancelled.' });
    }

    // If provider already started move (shared location while accepted), apply 100rs cancellation fee
    let cancellationFee = 0;
    if (booking.status === 'accepted' && (booking.providerCurrentLatitude || booking.providerCurrentLongitude)) {
      cancellationFee = 100;
      booking.cancellationFee = 100;
    }

    booking.status = 'cancelled';
    await booking.save();
    
    // Add notifications for cancel
    const populatedBooking = await Booking.findById(req.params.id).populate('customer provider');
    const customer = populatedBooking.customer;
    const provider = populatedBooking.provider;
    const feeMsg = cancellationFee > 0 ? ` Cancellation fee of ₹${cancellationFee} applies.` : '';
    customer.notifications.push({ message: `Your booking has been cancelled.${feeMsg}`, read: false });
    if (cancellationFee > 0) {
      provider.notifications.push({ message: `Booking cancelled by customer. Cancellation fee ₹${cancellationFee} pending payment.`, read: false });
    }
    await customer.save();
    if (cancellationFee > 0) await provider.save();

    const responseBody = {
      ...booking.toObject(),
      cancellationFee
    };

    res.json(responseBody);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

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

module.exports = router;