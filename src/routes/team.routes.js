const express = require('express');
const router = express.Router();
const teamController = require('../controllers/team.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { enforceTenant } = require('../middlewares/tenant.middleware');

router.use(verifyToken);
router.use(enforceTenant);

router.get('/', teamController.getTeam);
router.post('/invite', teamController.inviteMember);
router.put('/:id/role', teamController.updateRole);
router.patch('/:id/role', teamController.updateRole);
router.delete('/:id', teamController.removeMember);

module.exports = router;
