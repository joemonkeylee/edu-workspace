import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import Home from './pages/Home';
import BookViewer from './pages/BookViewer';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import NotFound from './pages/NotFound';
import ScrollToTop from './components/ScrollToTop';
import AdminLayout from './components/admin/AdminLayout';
import AuthGuard from './components/admin/AuthGuard';
import PdfScanImport from './components/admin/PdfScanImport';
import BooksTable from './components/admin/BooksTable';
import AnnotationsTable from './components/admin/AnnotationsTable';
import MistakesTable from './components/admin/MistakesTable';
import StorageSettings from './components/admin/StorageSettings';
import UsersTable from './components/admin/UsersTable';
import AuthSettings from './components/admin/AuthSettings';
import AssignmentsTable from './components/admin/AssignmentsTable';
import { useAuthStore } from './store/authStore';

export default function App() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => { init(); }, [init]);

  return (
    <BrowserRouter>
      <ScrollToTop />
      <Toaster position="top-center" richColors />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />

        <Route path="/" element={<Home />} />
        <Route path="/book/:id" element={<BookViewer />} />

        <Route path="/admin" element={<AuthGuard allowedRoles={['admin', 'editor']} />}>
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/scan" replace />} />
            <Route path="scan" element={<PdfScanImport />} />
            <Route path="books" element={<BooksTable />} />
            <Route path="annotations" element={<AnnotationsTable />} />
            <Route path="mistakes" element={<MistakesTable />} />
            <Route path="assignments" element={<AssignmentsTable />} />
            <Route path="users" element={<UsersTable />} />
            <Route path="auth-settings" element={<AuthSettings />} />
            <Route path="storage" element={<StorageSettings />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
