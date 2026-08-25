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
                    "line": 8
          },
          {
                    "name": "name",
                    "dataType": "STRING",
                    "constraints": [
                              "REQUIRED"
                    ],
                    "validations": [],
                    "defaultValue": null,
                    "line": 9
          },
          {
                    "name": "age",
                    "dataType": "INT",
                    "constraints": [],
                    "validations": [
                              {
                                        "type": "MIN",
                                        "value": 18
                              },
                              {
                                        "type": "MAX",
                                        "value": 60
                              }
                    ],
                    "defaultValue": {
                              "type": "NUMBER",
                              "value": 25
                    },
                    "line": 10
          },
          {
                    "name": "status",
                    "dataType": "STRING",
                    "constraints": [],
                    "validations": [],
                    "defaultValue": {
                              "type": "STRING",
                              "value": "active"
                    },
                    "line": 11
          },
          {
                    "name": "cgpa",
                    "dataType": "FLOAT",
                    "constraints": [],
                    "validations": [
                              {
                                        "type": "MIN",
                                        "value": 0
                              },
                              {
                                        "type": "MAX",
                                        "value": 10
                              }
                    ],
                    "defaultValue": {
                              "type": "NUMBER",
                              "value": 8.5
                    },
                    "line": 12
          },
          {
                    "name": "active",
                    "dataType": "BOOLEAN",
                    "constraints": [],
                    "validations": [],
                    "defaultValue": {
                              "type": "BOOLEAN",
                              "value": true
                    },
                    "line": 13
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
}

module.exports = StudentModel;
