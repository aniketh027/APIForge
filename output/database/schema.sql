-- ============================================================
-- MySQL Database Schema
-- Generated automatically by APIForge Compiler
-- ============================================================

CREATE TABLE Student (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL
);

CREATE TABLE Course (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL
);

-- ============================================================
-- Relationship Tables & Foreign Key Constraints
-- ============================================================

-- Relationship: Student ENROLLS_IN Course (MANY_TO_MANY)
CREATE TABLE Student_Course (
    student_id INT NOT NULL,
    course_id INT NOT NULL,
    PRIMARY KEY (student_id, course_id),
    FOREIGN KEY (student_id) REFERENCES Student(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES Course(id) ON DELETE CASCADE
);
