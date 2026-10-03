// Single place that defines where admins sign in. Kept free of server-only imports so the
// edge middleware can use it. To move the login, rename app/staff-login and change this value.
export const ADMIN_LOGIN_PATH = '/staff-login';
