/**
 * Course Controller
 * Generated automatically by APIForge Compiler
 */

const CourseModel = require('../models/Course');

/**
 * Validates input data for Course
 * @param {Object} data - Input payload
 * @returns {string|null} - Error message if invalid, null if valid
 */
function validateCourse(data) {
    if (!data || typeof data !== 'object') return null;
    return null;
}

async function createCourse(req, res) {
    try {
        const validationError = validateCourse(req.body);
        if (validationError) {
            return res.status(400).json({ success: false, error: validationError });
        }
        const result = await CourseModel.create(req.body);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function getCourses(req, res) {
    try {
        const items = await CourseModel.findAll();
        res.status(200).json({ success: true, data: items });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function getCourseById(req, res) {
    try {
        const item = await CourseModel.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ success: false, error: 'Course not found' });
        }
        res.status(200).json({ success: true, data: item });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function updateCourse(req, res) {
    try {
        const validationError = validateCourse(req.body);
        if (validationError) {
            return res.status(400).json({ success: false, error: validationError });
        }
        const updated = await CourseModel.update(req.params.id, req.body);
        if (!updated) {
            return res.status(404).json({ success: false, error: 'Course not found' });
        }
        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function deleteCourse(req, res) {
    try {
        const deleted = await CourseModel.delete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ success: false, error: 'Course not found' });
        }
        res.status(200).json({ success: true, message: 'Course deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    validateCourse,
    createCourse,
    getCourses,
    getCourseById,
    updateCourse,
    deleteCourse
};
