import { OverviewDashboard } from '@/components/dashboard/OverviewDashboard'

// Aggregated overview across all the user's watchlists. Auth is enforced by the
// (dashboard) layout; this server component just renders the client overview.
export default function DashboardPage() {
  return <OverviewDashboard />
}
