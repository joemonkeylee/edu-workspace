-- CreateTable
CREATE TABLE `typing_chapter_record` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dictId` VARCHAR(64) NOT NULL,
    `chapter` INTEGER NOT NULL,
    `userId` INTEGER NULL,
    `timeSec` INTEGER NOT NULL DEFAULT 0,
    `correctCount` INTEGER NOT NULL DEFAULT 0,
    `wrongCount` INTEGER NOT NULL DEFAULT 0,
    `wordCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `typing_chapter_record_userId_dictId_idx`(`userId`, `dictId`),
    INDEX `typing_chapter_record_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `typing_word_record` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `dictId` VARCHAR(64) NOT NULL,
    `chapter` INTEGER NOT NULL DEFAULT -1,
    `word` VARCHAR(128) NOT NULL,
    `wrongCount` INTEGER NOT NULL DEFAULT 0,
    `timing` JSON NULL,
    `mistakes` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `typing_word_record_userId_dictId_wrongCount_idx`(`userId`, `dictId`, `wrongCount`),
    INDEX `typing_word_record_userId_updatedAt_idx`(`userId`, `updatedAt`),
    UNIQUE INDEX `typing_word_record_userId_dictId_word_key`(`userId`, `dictId`, `word`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `typing_chapter_record` ADD CONSTRAINT `typing_chapter_record_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `typing_word_record` ADD CONSTRAINT `typing_word_record_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
