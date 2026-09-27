-- 作业批改结论（全对 / 有问题 + 问题标签 + 备注）
-- 由 `npx prisma migrate diff` 离线生成后人工裁出，只保留两张作业表的 ALTER。
-- 切勿改用 `prisma db push`：库里还有 schema 之外的遗留表 assignment_copy1 /
-- assignmentstroke_copy1，push 会把它们 DROP 掉。
ALTER TABLE `assignment` ADD COLUMN `gradeComment` VARCHAR(500) NOT NULL DEFAULT '',
    ADD COLUMN `gradeIssues` JSON NULL,
    ADD COLUMN `gradeResult` VARCHAR(16) NOT NULL DEFAULT '';

ALTER TABLE `pdf_assignment` ADD COLUMN `gradeComment` VARCHAR(500) NOT NULL DEFAULT '',
    ADD COLUMN `gradeIssues` JSON NULL,
    ADD COLUMN `gradeResult` VARCHAR(16) NOT NULL DEFAULT '';
