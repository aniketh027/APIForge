/**
 * Course REST API Routes
 * Generated automatically by APIForge Compiler
 */

const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');

// REST API CRUD endpoints
router.get('/', courseController.getCourses);
router.get('/:id', courseController.getCourseById);
router.post('/', courseController.createCourse);
router.put('/:id', courseController.updateCourse);
router.delete('/:id', courseController.deleteCourse);

module.exports = router;
