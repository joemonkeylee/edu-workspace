import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import BookViewer from './pages/BookViewer';
import AdminLayout from './components/admin/AdminLayout';
import AuthGuard from './components/admin/AuthGuard';
import PdfScanImport from './components/admin/PdfScanImport';
import BooksTable from './components/admin/BooksTable';
import AnnotationsTable from './components/admin/AnnotationsTable';
import MistakesTable from './components/admin/MistakesTable';
import StorageSettings from './components/admin/StorageSettings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/book/:id" element={<BookViewer />} />

        {/* Admin routes — guarded by AuthGuard for future RBAC */}
        <Route path="/admin" element={<AuthGuard allowedRoles={['admin', 'editor']} />}>
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/scan" replace />} />
            <Route path="scan" element={<PdfScanImport />} />
            <Route path="books" element={<BooksTable />} />
            <Route path="annotations" element={<AnnotationsTable />} />
            <Route path="mistakes" element={<MistakesTable />} />
            <Route path="storage" element={<StorageSettings />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
