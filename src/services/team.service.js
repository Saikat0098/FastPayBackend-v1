const TeamMember = require('../models/TeamMember');
const User = require('../models/User');
const ApiError = require('../utils/apiError');

const inviteTeamMember = async ({ merchantId, email, role = 'VIEWER' }) => {
  const cleanEmail = email.toLowerCase().trim();
  const existingMember = await TeamMember.findOne({ merchant: merchantId, email: cleanEmail });
  if (existingMember) {
    throw new ApiError(400, 'Member is already part of this merchant team');
  }

  let user = await User.findOne({ email: cleanEmail });
  if (!user) {
    user = await User.create({
      name: cleanEmail.split('@')[0],
      email: cleanEmail,
      password: 'TemporaryPassword123!',
      role: 'USER',
      merchant: merchantId,
      status: 'active',
    });
  } else {
    user.merchant = merchantId;
    await user.save();
  }

  const member = await TeamMember.create({
    merchant: merchantId,
    user: user._id,
    email: cleanEmail,
    role,
    status: 'ACTIVE',
  });

  return member;
};

const getTeamMembers = async (merchantId) => {
  return await TeamMember.find({ merchant: merchantId }).populate('user', 'name email phone role status');
};

const updateMemberRole = async (merchantId, memberId, role) => {
  const member = await TeamMember.findOneAndUpdate(
    { _id: memberId, merchant: merchantId },
    { $set: { role } },
    { new: true, runValidators: true }
  );

  if (!member) throw new ApiError(404, 'Team member not found');
  return member;
};

const removeTeamMember = async (merchantId, memberId) => {
  const member = await TeamMember.findOneAndDelete({ _id: memberId, merchant: merchantId });
  if (!member) throw new ApiError(404, 'Team member not found');
  return member;
};

module.exports = {
  inviteTeamMember,
  getTeamMembers,
  updateMemberRole,
  removeTeamMember,
};
