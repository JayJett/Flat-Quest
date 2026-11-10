import { MotionConfig } from 'motion/react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router'
import { AuthProvider } from '@/auth/AuthProvider'
import { RequireAuth, RequireHousehold } from '@/auth/guards'
import { AppShell } from '@/components/AppShell'
import { ToastProvider } from '@/components/Toast'
import { UserScopedHouseholdProvider } from '@/household/HouseholdProvider'
import { AuthCallbackPage, ResetPasswordPage } from '@/pages/AuthCallback'
import { FlatmateItemsPage, FlatmatesPage } from '@/pages/Flatmates'
import { HomePage } from '@/pages/Home'
import { ProfilePage } from '@/pages/Profile'
import { RoomDetailPage } from '@/pages/RoomDetail'
import { RoomsPage } from '@/pages/Rooms'
import { SettingsPage } from '@/pages/Settings'
import { SignInPage } from '@/pages/SignIn'
import { JoinPage, WelcomePage } from '@/pages/Welcome'
import { WishlistPage } from '@/pages/Wishlist'

function Providers() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <AuthProvider>
          <UserScopedHouseholdProvider>
            <Outlet />
          </UserScopedHouseholdProvider>
        </AuthProvider>
      </ToastProvider>
    </MotionConfig>
  )
}

const router = createBrowserRouter([
  {
    element: <Providers />,
    children: [
      { path: '/sign-in', element: <SignInPage /> },
      { path: '/auth/callback', element: <AuthCallbackPage /> },
      { path: '/auth/reset', element: <ResetPasswordPage /> },
      { path: '/welcome', element: <RequireAuth><WelcomePage /></RequireAuth> },
      { path: '/join', element: <RequireAuth><JoinPage /></RequireAuth> },
      {
        element: (
          <RequireAuth>
            <RequireHousehold>
              <AppShell />
            </RequireHousehold>
          </RequireAuth>
        ),
        children: [
          { index: true, element: <HomePage /> },
          { path: 'rooms', element: <RoomsPage /> },
          { path: 'rooms/:roomId', element: <RoomDetailPage /> },
          { path: 'wishlist', element: <WishlistPage /> },
          { path: 'flatmates', element: <FlatmatesPage /> },
          { path: 'flatmates/:userId', element: <FlatmateItemsPage /> },
          { path: 'profile', element: <ProfilePage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
