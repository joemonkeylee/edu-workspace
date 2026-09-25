-- CreateTable
CREATE TABLE `pdf_book` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(255) NOT NULL,
    `category` VARCHAR(255) NOT NULL DEFAULT '',
    `grade` VARCHAR(64) NOT NULL DEFAULT '',
    `subject` VARCHAR(64) NOT NULL DEFAULT '',
    `batchId` VARCHAR(64) NOT NULL DEFAULT '',
    `pdfKind` VARCHAR(16) NOT NULL DEFAULT 'pdf',
    `coverPage` INTEGER NOT NULL DEFAULT 1,
    `totalPages` INTEGER NOT NULL DEFAULT 0,
    `filePath` TEXT NOT NULL,
    `rootPath` TEXT NOT NULL,
    `relPath` TEXT NOT NULL,
    `rootId` INTEGER NULL,
    `missing` BOOLEAN NOT NULL DEFAULT false,
    `fileSize` INTEGER NOT NULL DEFAULT 0,
    `fileHash` VARCHAR(64) NULL,
    `pageSizes` JSON NULL,
    `searchable` VARCHAR(16) NOT NULL DEFAULT 'ok',
    `textStats` JSON NULL,
    `textExtracted` BOOLEAN NOT NULL DEFAULT false,
    `tocSource` VARCHAR(16) NOT NULL DEFAULT 'manual',
    `tocJson` JSON NOT NULL,
    `attributes` JSON NOT NULL,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pdf_book_fileHash_idx`(`fileHash`),
    INDEX `pdf_book_category_idx`(`category`),
    INDEX `pdf_book_grade_idx`(`grade`),
    INDEX `pdf_book_subject_idx`(`subject`),
    INDEX `pdf_book_searchable_idx`(`searchable`),
    INDEX `pdf_book_missing_idx`(`missing`),
    UNIQUE INDEX `pdf_book_title_category_key`(`title`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pdf_source_root` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `label` VARCHAR(255) NOT NULL DEFAULT '',
    `rootPath` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `bookCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pdf_page_text` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bookId` INTEGER NOT NULL,
    `pageNumber` INTEGER NOT NULL,
    `items` JSON NOT NULL,
    `plainText` TEXT NOT NULL,
    `charCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pdf_page_text_bookId_idx`(`bookId`),
    UNIQUE INDEX `pdf_page_text_bookId_pageNumber_key`(`bookId`, `pageNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pdf_thumb` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bookId` INTEGER NOT NULL,
    `pageNumber` INTEGER NOT NULL,
    `relPath` VARCHAR(512) NOT NULL,
    `width` INTEGER NOT NULL DEFAULT 0,
    `height` INTEGER NOT NULL DEFAULT 0,
    `bytes` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pdf_thumb_bookId_idx`(`bookId`),
    UNIQUE INDEX `pdf_thumb_bookId_pageNumber_key`(`bookId`, `pageNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pdf_annotation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bookId` INTEGER NOT NULL,
    `userId` INTEGER NULL,
    `pageNumber` INTEGER NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `contentJson` JSON NOT NULL,
    `tags` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pdf_annotation_userId_idx`(`userId`),
    INDEX `pdf_annotation_bookId_pageNumber_idx`(`bookId`, `pageNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pdf_mistake` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `annotationId` INTEGER NOT NULL,
    `bookId` INTEGER NOT NULL,
    `userId` INTEGER NULL,
    `pageNumber` INTEGER NOT NULL,
    `imagePath` VARCHAR(512) NOT NULL,
    `subject` VARCHAR(64) NOT NULL DEFAULT '',
    `tags` VARCHAR(512) NULL,
    `reviewStatus` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pdf_mistake_bookId_idx`(`bookId`),
    INDEX `pdf_mistake_annotationId_idx`(`annotationId`),
    INDEX `pdf_mistake_subject_idx`(`subject`),
    INDEX `pdf_mistake_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pdf_assignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bookId` INTEGER NOT NULL,
    `userId` INTEGER NULL,
    `title` VARCHAR(255) NOT NULL DEFAULT '',
    `subject` VARCHAR(64) NOT NULL DEFAULT '',
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `gradedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `gradedAt` DATETIME(3) NULL,

    INDEX `pdf_assignment_bookId_idx`(`bookId`),
    INDEX `pdf_assignment_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pdf_assignment_stroke` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assignmentId` INTEGER NOT NULL,
    `pageNumber` INTEGER NOT NULL,
    `layer` VARCHAR(10) NOT NULL DEFAULT 'student',
    `tool` VARCHAR(20) NOT NULL DEFAULT 'pen',
    `color` VARCHAR(20) NOT NULL DEFAULT '#000000',
    `width` DOUBLE NOT NULL DEFAULT 2,
    `points` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pdf_assignment_stroke_assignmentId_idx`(`assignmentId`),
    INDEX `pdf_assignment_stroke_assignmentId_pageNumber_idx`(`assignmentId`, `pageNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pdf_reading_progress` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `bookId` INTEGER NOT NULL,
    `pageNumber` INTEGER NOT NULL DEFAULT 1,
    `pageLayout` VARCHAR(20) NOT NULL DEFAULT 'single',
    `fitMode` VARCHAR(20) NOT NULL DEFAULT 'page',
    `scale` DOUBLE NOT NULL DEFAULT 1.5,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pdf_reading_progress_userId_idx`(`userId`),
    INDEX `pdf_reading_progress_bookId_idx`(`bookId`),
    UNIQUE INDEX `pdf_reading_progress_userId_bookId_key`(`userId`, `bookId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pdf_book_favorite` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `bookId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pdf_book_favorite_userId_idx`(`userId`),
    INDEX `pdf_book_favorite_bookId_idx`(`bookId`),
    UNIQUE INDEX `pdf_book_favorite_userId_bookId_key`(`userId`, `bookId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pdf_page_text` ADD CONSTRAINT `pdf_page_text_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `pdf_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pdf_thumb` ADD CONSTRAINT `pdf_thumb_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `pdf_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pdf_annotation` ADD CONSTRAINT `pdf_annotation_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `pdf_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pdf_annotation` ADD CONSTRAINT `pdf_annotation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pdf_mistake` ADD CONSTRAINT `pdf_mistake_annotationId_fkey` FOREIGN KEY (`annotationId`) REFERENCES `pdf_annotation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pdf_mistake` ADD CONSTRAINT `pdf_mistake_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `pdf_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pdf_mistake` ADD CONSTRAINT `pdf_mistake_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pdf_assignment` ADD CONSTRAINT `pdf_assignment_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `pdf_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pdf_assignment` ADD CONSTRAINT `pdf_assignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pdf_assignment_stroke` ADD CONSTRAINT `pdf_assignment_stroke_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `pdf_assignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pdf_reading_progress` ADD CONSTRAINT `pdf_reading_progress_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pdf_reading_progress` ADD CONSTRAINT `pdf_reading_progress_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `pdf_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pdf_book_favorite` ADD CONSTRAINT `pdf_book_favorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pdf_book_favorite` ADD CONSTRAINT `pdf_book_favorite_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `pdf_book`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

