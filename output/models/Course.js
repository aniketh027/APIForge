/**
 * Course Model
 * Generated automatically by APIForge Compiler
 */

const pool = require('../config/db');

class CourseModel {
    static get tableName() {
        return 'Course';
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
                    "line": 11
          },
          {
                    "name": "title",
                    "dataType": "STRING",
                    "constraints": [
                              "REQUIRED"
                    ],
                    "validations": [],
                    "defaultValue": null,
                    "line": 12
          }
];
    }

    static async findAll() {
        const [rows] = await pool.query('SELECT * FROM Course');
        return rows;
    }

    static async findById(id) {
        const [rows] = await pool.query('SELECT * FROM Course WHERE id = ?', [id]);
        return rows.length > 0 ? rows[0] : null;
    }

    static async create(data) {
        const [result] = await pool.query('INSERT INTO Course SET ?', [data]);
        return { id: result.insertId, ...data };
    }

    static async update(id, data) {
        await pool.query('UPDATE Course SET ? WHERE id = ?', [data, id]);
        return await this.findById(id);
    }

    static async delete(id) {
        const [result] = await pool.query('DELETE FROM Course WHERE id = ?', [id]);
        return result.affectedRows > 0;
    }
}

module.exports = CourseModel;
