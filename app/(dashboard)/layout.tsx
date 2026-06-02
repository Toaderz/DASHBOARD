import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import { TourProvider } from '@/components/onboarding/TourProvider'
import { TourSpotlight } from '@/components/onboarding/TourSpotlight'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_seen')
    .eq('id', user.id)
    .maybeSingle()

  const onboardingSeen = profile?.onboarding_seen ?? false

  return (
    <TourProvider onboardingSeen={onboardingSeen} userId={user.id}>
      <DashboardShell user={user}>{children}</DashboardShell>
      <TourSpotlight />
    </TourProvider>
  )
}
