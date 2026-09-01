# edu-workspace

教材/教辅 PDF 后台动态扫描导入、REST API 管理、前端 React + Zustand 可视化阅读、Canvas 批注与错题裁剪归类系统。

## 架构

Monorepo 单仓多目录：
- `/server` — Node.js + Express + Prisma 后端服务
- `/client` — React + Vite + Zustand 前端应用 (PC & Pad)

## 快速开始

```bash
# 安装所有依赖
npm install

# 数据库迁移
cd server && npx prisma db push && cd ..

# 同时启动前后端开发服务
npm run dev
```

后端运行在 http://localhost:4000，前端运行在 http://localhost:5173

## 核心功能

- **PDF 扫描导入**：输入本地绝对路径，自动扫描 PDF、解析大纲、切图存储、写入数据库，SSE 实时返回日志
- **书籍管理**：REST API 管理书籍、目录、页面图片
- **阅读批注**：左侧目录树导航、中间高清图、Canvas 批注（笔记/高亮/错题裁剪）
- **错题本**：裁剪错题入库、按学科/标签分类、复习状态管理
