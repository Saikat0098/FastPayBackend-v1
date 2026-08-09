const asyncHandler = require('../utils/asyncHandler');
const teamService = require('../services/team.service');

const inviteMember = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const member = await teamService.inviteTeamMember({
    merchantId,
    email: req.body.email,
    role: req.body.role,
  });

  return res.status(201).json({
    success: true,
    data: member,
    message: 'Team member invited successfully',
  });
});

const getTeam = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const members = await teamService.getTeamMembers(merchantId);

  return res.status(200).json({
    success: true,
    data: members,
    message: 'Team members retrieved successfully',
  });
});

const updateRole = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  const member = await teamService.updateMemberRole(merchantId, req.params.id, req.body.role);

  return res.status(200).json({
    success: true,
    data: member,
    message: 'Role updated successfully',
  });
});

const removeMember = asyncHandler(async (req, res) => {
  const merchantId = req.merchantId || req.merchant?._id;
  await teamService.removeTeamMember(merchantId, req.params.id);

  return res.status(200).json({
    success: true,
    message: 'Team member removed successfully',
  });
});

module.exports = {
  inviteMember,
  getTeam,
  updateRole,
  removeMember,
};
