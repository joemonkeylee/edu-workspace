import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ConfirmProvider } from './components/ConfirmDialog';
import Home from './pages/Home';
import Landing from './pages/Landing';
import BookViewer from './pages/BookViewer';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import NotFound from './pages/NotFound';
import ScrollToTop from './components/ScrollToTop';
import AdminLayout from './components/admin/AdminLayout';
import AuthGuard from './components/admin/AuthGuard';
import PdfScanImport from './components/admin/PdfScanImport';
import AdminDashboard from './components/admin/AdminDashboard';
import BooksTable from './components/admin/BooksTable';
import AnnotationsTable from './components/admin/AnnotationsTable';
import MistakesTable from './components/admin/MistakesTable';
import StorageSettings from './components/admin/StorageSettings';
import UsersTable from './components/admin/UsersTable';
import AuthSettings from './components/admin/AuthSettings';
import AssignmentsTable from './components/admin/AssignmentsTable';
import BookPairs from './components/admin/BookPairs';
import DbBackup from './components/admin/DbBackup';
import LandingLayout from './english/components/LandingLayout';
import EnglishPage from './english/components/EnglishPage';
import { useAuthStore } from './store/authStore';

// PDF 原生模块（feature/pdf-native）——独立于既有页面的一套流程。
// 用 lazy 引入，pdfjs（约 1MB）只在真正进入 /pdf 路由时才下载。
const PdfHome = lazy(() => import('./pdf/pages/PdfHome'));
const PdfBookViewer = lazy(() => import('./pdf/pages/PdfBookViewer'));
// 单词打字练习模块：词库 JSON 在运行时按需 fetch，代码本身很小
const TypingHome = lazy(() => import('./typing/TypingHome'));

function PdfSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 text-sm">
          正在加载模块…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export default function App() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => { init(); }, [init]);

  return (
    <BrowserRouter>
      <ConfirmProvider>
        <ScrollToTop />
        <Toaster position="top-center" richColors />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          <Route path="/" element={<Landing />} />
          <Route path="/books" element={<Home />} />
          <Route path="/book/:id" element={<BookViewer />} />

          {/* PDF 原生模块：独立路由前缀，不与上面任何一条产生交集 */}
          <Route path="/pdf" element={<PdfSuspense><PdfHome /></PdfSuspense>} />
          <Route path="/pdf/book/:id" element={<PdfSuspense><PdfBookViewer /></PdfSuspense>} />

          <Route path="/admin" element={<AuthGuard allowedRoles={['admin', 'teacher']} redirectTo="/" />}>
          <Route element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="scan" element={<AuthGuard allowedRoles={['admin']} redirectTo="/admin/books"><PdfScanImport /></AuthGuard>} />
            <Route path="books" element={<BooksTable />} />
            <Route path="book-pairs" element={<BookPairs />} />
            <Route path="annotations" element={<AnnotationsTable />} />
            <Route path="mistakes" element={<MistakesTable />} />
            <Route path="assignments" element={<AssignmentsTable />} />
            <Route path="users" element={<AuthGuard allowedRoles={['admin']} redirectTo="/admin/books"><UsersTable /></AuthGuard>} />
            <Route path="auth-settings" element={<AuthGuard allowedRoles={['admin']} redirectTo="/admin/books"><AuthSettings /></AuthGuard>} />
            <Route path="storage" element={<AuthGuard allowedRoles={['admin']} redirectTo="/admin/books"><StorageSettings /></AuthGuard>} />
            <Route path="db-backup" element={<AuthGuard allowedRoles={['admin']} redirectTo="/admin/books"><DbBackup /></AuthGuard>} />
          </Route>
        </Route>

          <Route path="/english" element={<LandingLayout><EnglishPage /></LandingLayout>} />
        <Route path="/english/:bookIdx/:lessonIdx" element={<LandingLayout><EnglishPage /></LandingLayout>} />

        <Route path="/typing" element={<LandingLayout><PdfSuspense><TypingHome /></PdfSuspense></LandingLayout>} />

        <Route path="*" element={<NotFound />} />
        </Routes>
      </ConfirmProvider>
    </BrowserRouter>
  );
}
