const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, default: 'customer' },
  phone: String,
  location: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    }
  },
  
  serviceType: String,
  idProof: String,
  status: { type: String, default: 'pending' }, // 'pending', 'approved', 'rejected'
  notifications: [{ message: String, date: { type: Date, default: Date.now }, read: { type: Boolean, default: false } }],
  finePending: { type: Boolean, default: false },
  rating: { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

// Virtual for backward compatibility
UserSchema.virtual('isApproved').get(function() {
  return this.status === 'approved';
});

UserSchema.set('toJSON', { virtuals: true });
UserSchema.index({ location: '2dsphere' });

UserSchema.set('toJSON', { virtuals: true });
UserSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('User', UserSchema);

