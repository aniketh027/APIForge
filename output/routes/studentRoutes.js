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

// Relationship endpoints
// Relationship: Student ENROLLS_IN Course (MANY_TO_MANY)
router.get('/:id/courses', studentController.getCourses);
router.post('/:id/courses/:courseId', studentController.addCourse);
router.delete('/:id/courses/:courseId', studentController.removeCourse);

module.exports = router;
