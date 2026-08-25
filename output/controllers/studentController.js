/**
 * Student Controller
 * Generated automatically by APIForge Compiler
 */

const StudentModel = require('../models/Student');

/**
 * Validates input data for Student
 * @param {Object} data - Input payload
 * @returns {string|null} - Error message if invalid, null if valid
 */
function validateStudent(data) {
    if (!data || typeof data !== 'object') return null;

    if (data.age !== undefined && data.age !== null && data.age < 18) {
        return "Field 'age' must be >= 18.";
    }
    if (data.age !== undefined && data.age !== null && data.age > 60) {
        return "Field 'age' must be <= 60.";
    }
    if (data.cgpa !== undefined && data.cgpa !== null && data.cgpa < 0) {
        return "Field 'cgpa' must be >= 0.";
    }
    if (data.cgpa !== undefined && data.cgpa !== null && data.cgpa > 10) {
        return "Field 'cgpa' must be <= 10.";
    }
    return null;
}

async function createStudent(req, res) {
    try {
        const validationError = validateStudent(req.body);
        if (validationError) {
            return res.status(400).json({ success: false, error: validationError });
        }
        const result = await StudentModel.create(req.body);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function getStudents(req, res) {
    try {
        const items = await StudentModel.findAll();
        res.status(200).json({ success: true, data: items });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function getStudentById(req, res) {
    try {
        const item = await StudentModel.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }
        res.status(200).json({ success: true, data: item });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function updateStudent(req, res) {
    try {
        const validationError = validateStudent(req.body);
        if (validationError) {
            return res.status(400).json({ success: false, error: validationError });
        }
        const updated = await StudentModel.update(req.params.id, req.body);
        if (!updated) {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }
        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function deleteStudent(req, res) {
    try {
        const deleted = await StudentModel.delete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }
        res.status(200).json({ success: true, message: 'Student deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    validateStudent,
    createStudent,
    getStudents,
    getStudentById,
    updateStudent,
    deleteStudent
};
