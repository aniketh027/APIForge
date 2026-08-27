/**
 * Student Model
 * Generated automatically by APIForge Compiler
 */

const pool = require('../config/db');

class StudentModel {
    static get tableName() {
        return 'Student';
    }

    static get fields() {
        return [
          {
                    "name": "id",
                    "dataType": "INT",
                    "constraints": [
                              "PRIMARY_KEY"
                    ],
                    "validations": [],
                    "defaultValue": null,
                    "line": 6
          },
          {
                    "name": "name",
                    "dataType": "STRING",
                    "constraints": [
                              "REQUIRED"
                    ],
                    "validations": [],
                    "defaultValue": null,
                    "line": 7
          }
];
    }

    static async findAll() {
        const [rows] = await pool.query('SELECT * FROM Student');
        return rows;
    }

    static async findById(id) {
        const [rows] = await pool.query('SELECT * FROM Student WHERE id = ?', [id]);
        return rows.length > 0 ? rows[0] : null;
    }

    static async create(data) {
        const [result] = await pool.query('INSERT INTO Student SET ?', [data]);
        return { id: result.insertId, ...data };
    }

    static async update(id, data) {
        await pool.query('UPDATE Student SET ? WHERE id = ?', [data, id]);
        return await this.findById(id);
    }

    static async delete(id) {
        const [result] = await pool.query('DELETE FROM Student WHERE id = ?', [id]);
        return result.affectedRows > 0;
    }

    // Relationship: Student ENROLLS_IN Course (MANY_TO_MANY)
    static async getCourses(studentId) {
        const [rows] = await pool.query(
            'SELECT t.* FROM Course t JOIN Student_Course j ON t.id = j.course_id WHERE j.student_id = ?',
            [studentId]
        );
        return rows;
    }

    static async addCourse(studentId, courseId) {
        await pool.query(
            'INSERT INTO Student_Course (student_id, course_id) VALUES (?, ?)',
            [studentId, courseId]
        );
        return { student_id: studentId, course_id: courseId };
    }

    static async removeCourse(studentId, courseId) {
        const [result] = await pool.query(
            'DELETE FROM Student_Course WHERE student_id = ? AND course_id = ?',
            [studentId, courseId]
        );
        return result.affectedRows > 0;
    }
}

module.exports = StudentModel;
