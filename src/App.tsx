import { lazy, Suspense } from 'react'
import { FullScreenLoader } from '@/auth/guards'
import { MotionConfig } from 'motion/react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router'
import { AuthProvider } from '@/auth/AuthProvider'
import { RequireAuth, RequireHousehold } from '@/auth/guards'
import { AppShell } from '@/components/AppShell'
import { RouteError } from '@/components/RouteError'
import { ToastProvider } from '@/components/Toast'
import { UserScopedHouseholdProvider } from '@/household/HouseholdProvider'
import { BASE_PATH } from '@/lib/urls'

const AuthCallbackPage = lazy(() => import('@/pages/AuthCallback').then((m) => ({ default: m.AuthCallbackPage })))
const ResetPasswordPage = lazy(() => import('@/pages/AuthCallback').then((m) => ({ default: m.ResetPasswordPage })))
const FlatmateItemsPage = lazy(() => import('@/pages/Flatmates').then((m) => ({ default: m.FlatmateItemsPage })))
const FlatmatesPage = lazy(() => import('@/pages/Flatmates').then((m) => ({ default: m.FlatmatesPage })))
const HomePage = lazy(() => import('@/pages/Home').then((m) => ({ default: m.HomePage })))
const ProfilePage = lazy(() => import('@/pages/Profile').then((m) => ({ default: m.ProfilePage })))
const RoomDetailPage = lazy(() => import('@/pages/RoomDetail').then((m) => ({ default: m.RoomDetailPage })))
const RoomsPage = lazy(() => import('@/pages/Rooms').then((m) => ({ default: m.RoomsPage })))
const VisualHomePage = lazy(() => import('@/pages/VisualHome').then((m) => ({ default: m.VisualHomePage })))
const ShoppingPage = lazy(() => import('@/pages/Shopping').then((m) => ({ default: m.ShoppingPage })))
const SettingsPage = lazy(() => import('@/pages/Settings').then((m) => ({ default: m.SettingsPage })))
const SignInPage = lazy(() => import('@/pages/SignIn').then((m) => ({ default: m.SignInPage })))
const JoinPage = lazy(() => import('@/pages/Welcome').then((m) => ({ default: m.JoinPage })))
const WelcomePage = lazy(() => import('@/pages/Welcome').then((m) => ({ default: m.WelcomePage })))
const WishlistPage = lazy(() => import('@/pages/Wishlist').then((m) => ({ default: m.WishlistPage })))

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
    errorElement: <RouteError />,
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
          { path: 'rooms/shopping', element: <ShoppingPage /> },
          { path: 'rooms/:roomId', element: <RoomDetailPage /> },
          { path: 'rooms/:roomId/visual', element: <VisualHomePage /> },
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
], { basename: BASE_PATH || '/' })

export default function App() {
  return <Suspense fallback={<FullScreenLoader />}><RouterProvider router={router} /></Suspense>
}
