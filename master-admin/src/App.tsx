import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth, Shell } from "@/components/Shell";
import { ThemeProvider } from "@/lib/theme";
import { ActivityPage } from "@/pages/ActivityPage";
import { CompaniesPage } from "@/pages/CompaniesPage";
import { CompanyDetailPage } from "@/pages/CompanyDetailPage";
import { DataPage } from "@/pages/DataPage";
import { EmailQueuePage } from "@/pages/EmailQueuePage";
import { LoginPage } from "@/pages/LoginPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { StaffPage } from "@/pages/StaffPage";
import { UsersPage } from "@/pages/UsersPage";
import "@/styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<Shell />}>
                <Route index element={<OverviewPage />} />
                <Route path="companies" element={<CompaniesPage />} />
                <Route path="companies/:id" element={<CompanyDetailPage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="staff" element={<StaffPage />} />
                <Route path="email" element={<EmailQueuePage />} />
                <Route path="activity" element={<ActivityPage />} />
                <Route path="data" element={<DataPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
