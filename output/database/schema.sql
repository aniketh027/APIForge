-- ============================================================
-- MySQL Database Schema
-- Generated automatically by APIForge Compiler
-- ============================================================

CREATE TABLE Student (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    age INT DEFAULT 25 CHECK (age >= 18 AND age <= 60),
    status VARCHAR(255) DEFAULT 'active',
    cgpa FLOAT DEFAULT 8.5 CHECK (cgpa >= 0 AND cgpa <= 10),
    active BOOLEAN DEFAULT TRUE
);
