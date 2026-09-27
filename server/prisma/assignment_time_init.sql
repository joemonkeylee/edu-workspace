-- 作业用时统计：提交时刻 submittedAt + 预估用时 estimatedMinutes
-- 由人工编写（同 assignment_grade_result_init.sql 的原因），避免 db push 删掉
-- 库里遗留的 assignment_copy1 / assignmentstroke_copy1 备份表。
ALTER TABLE `assignment`
    ADD COLUMN `submittedAt` DATETIME(3) NULL AFTER `updatedAt`,
    ADD COLUMN `estimatedMinutes` INTEGER NOT NULL DEFAULT 30 AFTER `gradedAt`;

ALTER TABLE `pdf_assignment`
    ADD COLUMN `submittedAt` DATETIME(3) NULL AFTER `updatedAt`,
    ADD COLUMN `estimatedMinutes` INTEGER NOT NULL DEFAULT 30 AFTER `gradedAt`;
