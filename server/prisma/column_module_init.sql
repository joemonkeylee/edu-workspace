-- ── 专栏 PDF 模块（column）────────────────────────────────────
-- 独立表族，主键用短雪花 id（VARCHAR(20)，base62）。不改动既有 pdf_* 表。
-- 结构参考 pdf_* 扩展而来，仅主键类型不同（String 而非 Int），并新增 series 字段。
-- 仅建新表，不 DROP / 不 ALTER 任何既有表。重复执行会因表已存在而报错，勿再跑。

-- CreateTable
CREATE TABLE `column_book` (
    `id` VARCHAR(20) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `category` VARCHAR(255) NOT NULL DEFAULT '',
    `grade` VARCHAR(64) NOT NULL DEFAULT '',
    `subject` VARCHAR(64) NOT NULL DEFAULT '',
    `series` VARCHAR(128) NOT NULL DEFAULT '',
    `batchId` VARCHAR(64) NOT NULL DEFAULT '',
    `pdfKind` VARCHAR(16) NOT NULL DEFAULT 'pdf',
    `coverPage` INTEGER NOT NULL DEFAULT 1,
    `totalPages` INTEGER NOT NULL DEFAULT 0,
    `filePath` TEXT NOT NULL,
    `rootPath` TEXT NOT NULL,
    `relPath` TEXT NOT NULL,
    `rootId` INTEGER NULL,
    `missing` TINYINT(1) NOT NULL DEFAULT 0,
    `fileSize` INTEGER NOT NULL DEFAULT 0,
    `fileHash` VARCHAR(64) NULL,
    `pageSizes` JSON NULL,
    `searchable` VARCHAR(16) NOT NULL DEFAULT 'ok',
    `textStats` JSON NULL,
    `textExtracted` TINYINT(1) NOT NULL DEFAULT 0,
    `tocSource` VARCHAR(16) NOT NULL DEFAULT 'manual',
    `tocJson` JSON NOT NULL DEFAULT ('[]'),
    `attributes` JSON NOT NULL DEFAULT ('{}'),
    `isDeleted` TINYINT(1) NOT NULL DEFAULT 0,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `column_book_rootPath_relPath_idx`(`rootPath`(255), `relPath`(255)),
    INDEX `column_book_fileHash_idx`(`fileHash`),
    INDEX `column_book_subject_idx`(`subject`),
    INDEX `column_book_grade_idx`(`grade`),
    INDEX `column_book_series_idx`(`series`),
    INDEX `column_book_category_idx`(`category`),
    INDEX `column_book_batchId_idx`(`batchId`),
    INDEX `column_book_searchable_idx`(`searchable`),
    INDEX `column_book_missing_idx`(`missing`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `column_video` (
    `id` VARCHAR(20) NOT NULL,
    `bookId` VARCHAR(20) NOT NULL,
    `title` VARCHAR(512) NOT NULL DEFAULT '',
    `fileName` VARCHAR(512) NOT NULL DEFAULT '',
    `filePath` TEXT NOT NULL,
    `rootPath` TEXT NOT NULL,
    `relPath` TEXT NOT NULL,
    `lessonNo` INTEGER NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `matchScore` FLOAT NOT NULL DEFAULT 0,
    `scope` VARCHAR(16) NOT NULL DEFAULT 'lesson',
    `missing` TINYINT(1) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `column_video_bookId_idx`(`bookId`),
    INDEX `column_video_bookId_sortOrder_idx`(`bookId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `column_page_text` (
    `id` VARCHAR(20) NOT NULL,
    `bookId` VARCHAR(20) NOT NULL,
    `pageNumber` INTEGER NOT NULL,
    `items` JSON NOT NULL,
    `plainText` TEXT NOT NULL,
    `charCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `column_page_text_bookId_pageNumber_key`(`bookId`, `pageNumber`),
    INDEX `column_page_text_bookId_idx`(`bookId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `column_thumb` (
    `id` VARCHAR(20) NOT NULL,
    `bookId` VARCHAR(20) NOT NULL,
    `pageNumber` INTEGER NOT NULL,
    `relPath` VARCHAR(512) NOT NULL,
    `width` INTEGER NOT NULL DEFAULT 0,
    `height` INTEGER NOT NULL DEFAULT 0,
    `bytes` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `column_thumb_bookId_pageNumber_key`(`bookId`, `pageNumber`),
    INDEX `column_thumb_bookId_idx`(`bookId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `column_annotation` (
    `id` VARCHAR(20) NOT NULL,
    `bookId` VARCHAR(20) NOT NULL,
    `userId` INTEGER NULL,
    `pageNumber` INTEGER NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `contentJson` JSON NOT NULL,
    `tags` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `column_annotation_userId_idx`(`userId`),
    INDEX `column_annotation_bookId_pageNumber_idx`(`bookId`, `pageNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `column_mistake` (
    `id` VARCHAR(20) NOT NULL,
    `annotationId` VARCHAR(20) NOT NULL,
    `bookId` VARCHAR(20) NOT NULL,
    `userId` INTEGER NULL,
    `pageNumber` INTEGER NOT NULL,
    `imagePath` VARCHAR(512) NOT NULL,
    `subject` VARCHAR(64) NOT NULL DEFAULT '',
    `tags` VARCHAR(512) NULL,
    `reviewStatus` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `column_mistake_bookId_idx`(`bookId`),
    INDEX `column_mistake_annotationId_idx`(`annotationId`),
    INDEX `column_mistake_subject_idx`(`subject`),
    INDEX `column_mistake_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `column_assignment` (
    `id` VARCHAR(20) NOT NULL,
    `bookId` VARCHAR(20) NOT NULL,
    `userId` INTEGER NULL,
    `title` VARCHAR(255) NOT NULL DEFAULT '',
    `subject` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `gradedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `submittedAt` DATETIME(3) NULL,
    `gradedAt` DATETIME(3) NULL,
    `estimatedMinutes` INTEGER NOT NULL DEFAULT 30,
    `gradeResult` VARCHAR(16) NOT NULL DEFAULT '',
    `gradeIssues` JSON NULL,
    `gradeComment` VARCHAR(500) NOT NULL DEFAULT '',

    INDEX `column_assignment_bookId_idx`(`bookId`),
    INDEX `column_assignment_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `column_assignment_stroke` (
    `id` VARCHAR(20) NOT NULL,
    `assignmentId` VARCHAR(20) NOT NULL,
    `pageNumber` INTEGER NOT NULL,
    `layer` VARCHAR(10) NOT NULL DEFAULT 'student',
    `tool` VARCHAR(20) NOT NULL DEFAULT 'pen',
    `color` VARCHAR(20) NOT NULL DEFAULT '#000000',
    `width` FLOAT NOT NULL DEFAULT 2,
    `points` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `column_assignment_stroke_assignmentId_idx`(`assignmentId`),
    INDEX `column_assignment_stroke_assignmentId_pageNumber_idx`(`assignmentId`, `pageNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `column_reading_progress` (
    `id` VARCHAR(20) NOT NULL,
    `userId` INTEGER NULL,
    `bookId` VARCHAR(20) NOT NULL,
    `pageNumber` INTEGER NOT NULL DEFAULT 1,
    `pageLayout` VARCHAR(20) NOT NULL DEFAULT 'single',
    `fitMode` VARCHAR(20) NOT NULL DEFAULT 'page',
    `scale` FLOAT NOT NULL DEFAULT 1.5,
    `rotation` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `column_reading_progress_userId_bookId_key`(`userId`, `bookId`),
    INDEX `column_reading_progress_userId_idx`(`userId`),
    INDEX `column_reading_progress_bookId_idx`(`bookId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `column_book_favorite` (
    `id` VARCHAR(20) NOT NULL,
    `userId` INTEGER NULL,
    `bookId` VARCHAR(20) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `column_book_favorite_userId_bookId_key`(`userId`, `bookId`),
    INDEX `column_book_favorite_userId_idx`(`userId`),
    INDEX `column_book_favorite_bookId_idx`(`bookId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `column_video` ADD CONSTRAINT `column_video_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `column_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_page_text` ADD CONSTRAINT `column_page_text_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `column_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_thumb` ADD CONSTRAINT `column_thumb_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `column_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_annotation` ADD CONSTRAINT `column_annotation_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `column_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_annotation` ADD CONSTRAINT `column_annotation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_mistake` ADD CONSTRAINT `column_mistake_annotationId_fkey` FOREIGN KEY (`annotationId`) REFERENCES `column_annotation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_mistake` ADD CONSTRAINT `column_mistake_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `column_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_mistake` ADD CONSTRAINT `column_mistake_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_assignment` ADD CONSTRAINT `column_assignment_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `column_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_assignment` ADD CONSTRAINT `column_assignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_assignment_stroke` ADD CONSTRAINT `column_assignment_stroke_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `column_assignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_reading_progress` ADD CONSTRAINT `column_reading_progress_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_reading_progress` ADD CONSTRAINT `column_reading_progress_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `column_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_book_favorite` ADD CONSTRAINT `column_book_favorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `column_book_favorite` ADD CONSTRAINT `column_book_favorite_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `column_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
