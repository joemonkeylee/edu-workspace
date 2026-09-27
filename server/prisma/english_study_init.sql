-- 英语精听学习记录 + 按天统计 的 DDL（prisma migrate diff 离线生成）
-- 注意：本库有不在 schema 里的遗留表，禁止 prisma db push。本文件用于人工执行。

-- CreateTable
CREATE TABLE `english_study_record` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `bookId` VARCHAR(64) NOT NULL,
    `lessonId` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `english_study_record_userId_updatedAt_idx`(`userId`, `updatedAt`),
    UNIQUE INDEX `english_study_record_userId_bookId_lessonId_key`(`userId`, `bookId`, `lessonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `english_daily_stat` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `date` VARCHAR(10) NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `english_daily_stat_userId_updatedAt_idx`(`userId`, `updatedAt`),
    UNIQUE INDEX `english_daily_stat_userId_date_key`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `english_study_record` ADD CONSTRAINT `english_study_record_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `english_daily_stat` ADD CONSTRAINT `english_daily_stat_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
