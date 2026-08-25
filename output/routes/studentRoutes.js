/**
 * Student REST API Routes
 * Generated automatically by APIForge Compiler
 */

const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');

// REST API CRUD endpoints
router.get('/', studentController.getStudents);
router.get('/:id', studentController.getStudentById);
router.post('/', studentController.createStudent);
router.put('/:id', studentController.updateStudent);
router.delete('/:id', studentController.deleteStudent);

module.exports = router;
