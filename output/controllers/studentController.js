/**
 * Student Controller
 * Generated automatically by APIForge Compiler
 */

const StudentModel = require('../models/Student');

async function createStudent(req, res) {
    try {
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

async function getCourses(req, res) {
    try {
        const items = await StudentModel.getCourses(req.params.id);
        res.status(200).json({ success: true, data: items });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function addCourse(req, res) {
    try {
        const result = await StudentModel.addCourse(req.params.id, req.params.courseId);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function removeCourse(req, res) {
    try {
        const success = await StudentModel.removeCourse(req.params.id, req.params.courseId);
        res.status(200).json({ success: true, message: 'Association removed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    createStudent,
    getStudents,
    getStudentById,
    updateStudent,
    deleteStudent,
    getCourses,
    addCourse,
    removeCourse
};
