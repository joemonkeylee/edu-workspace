-- ── 专栏 PDF：column_book 增加 sourcePath 列 ─────────────────────
-- 用途：拷贝式入库时记录源盘绝对路径，便于
--   1) 下次扫描时标记「该源文件已迁移入库」；
--   2) 重复拷贝同一源文件时按 sourcePath 去重。
-- 仅 ADD COLUMN + ADD INDEX，不改任何既有列。重复执行会报 duplicate column，勿再跑。

ALTER TABLE `column_book`
  ADD COLUMN `sourcePath` VARCHAR(768) NOT NULL DEFAULT '';

ALTER TABLE `column_book`
  ADD INDEX `column_book_sourcePath_idx` (`sourcePath`(191));
