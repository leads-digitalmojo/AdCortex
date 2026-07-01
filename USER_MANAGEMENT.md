# User Management Implementation Guide

## Overview

Your AdPilot web app now has a complete **user management system** that allows administrators to create, edit, and manage team members with different access levels.

## Architecture

### Backend (Already Implemented)
**Location**: `/adpilot/server/auth.ts`

The backend provides:
- **User Storage**: PostgreSQL database with fallback to JSON file storage (`ads_agent/data/access_users.json`)
- **Authentication**: Session-based auth with rate limiting
- **API Endpoints**:
  - `POST /api/access/users` - Create new user (admin only)
  - `GET /api/access/users` - List all users (admin only)
  - `PUT /api/access/users/:userId` - Update user (admin only)
  - `POST /api/auth/login` - User login
  - `POST /api/auth/logout` - User logout
  - `GET /api/auth/me` - Get current user

### Database Schema
**Location**: `/adpilot/shared/schema.ts`

```typescript
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  status: text("status", { enum: ["active", "blocked"] }).notNull().default("active"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

### Frontend (Just Implemented)
**Location**: `/adpilot/client/src/pages/users.tsx`

A complete admin UI for user management with:
- Search and filter users
- Create new users
- Edit user details (name, role, password)
- Change user roles (admin/member)
- Block/unblock users
- View user creation and last login timestamps

## Features

### User Roles
- **Admin**: Full access to user management, client management, and settings
- **Member**: Can view and execute operations on ad campaigns

### User Status
- **Active**: User can log in and access the application
- **Blocked**: User is prevented from logging in

### Password Management
- Minimum 8 characters required
- Hashed using scrypt with salt
- Can be updated by admins
- Bootstrap admin uses environment variables for initial credentials

## How to Use

### 1. Access User Management (Admin Only)

1. Navigate to the **Users** page from the sidebar (appears only for admins)
2. You'll see a list of all users with their details

### 2. Create a New User

1. Click the **"Add User"** button
2. Fill in the form:
   - **Email**: Must be valid and unique
   - **Full Name**: User's display name
   - **Password**: At least 8 characters
   - **Role**: Choose between "Member" or "Administrator"
   - **Status**: Set to "Active" (users can't log in if blocked)
3. Click **"Create User"**

### 3. Edit an Existing User

1. Click the **Edit** button (pencil icon) next to the user
2. You can modify:
   - Full Name
   - Password (optional - leave blank to keep current)
   - Role
   - Status
3. Click **"Update User"**

### 4. Block a User

1. Click the **Delete** button (trash icon) next to the user
2. The user will be marked as "Blocked" and can no longer log in

## API Usage Examples

### Create a User (cURL)

```bash
curl -X POST http://localhost:5000/api/access/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "name": "John Doe",
    "password": "SecurePassword123",
    "role": "member",
    "status": "active"
  }'
```

### Get All Users

```bash
curl http://localhost:5000/api/access/users \
  -H "Cookie: adpilot_prod_sid=YOUR_SESSION_ID"
```

### Update a User

```bash
curl -X PUT http://localhost:5000/api/access/users/{userId} \
  -H "Content-Type: application/json" \
  -H "Cookie: adpilot_prod_sid=YOUR_SESSION_ID" \
  -d '{
    "name": "Jane Doe",
    "role": "admin",
    "status": "active"
  }'
```

## Environment Variables

### Bootstrap Admin
Set these in your `.env` file to configure the initial admin user:

```bash
# Default: admin@adpilot.local
AUTH_BOOTSTRAP_EMAIL=admin@yourdomain.com

# Default: change-me-123
AUTH_BOOTSTRAP_PASSWORD=YourSecurePassword123

# Default: Administrator
AUTH_BOOTSTRAP_NAME=Admin User Name
```

### Session Management
```bash
# Required in production
SESSION_SECRET=your-secret-key-here

# Database for sessions (defaults to PostgreSQL)
AUTH_USE_PG_SESSIONS=true  # or false to use in-memory sessions

# Cookie settings
AUTH_COOKIE_SECURE=true    # Use HTTPS cookies
AUTH_COOKIE_SAMESITE=strict
```

## File Locations

- **User Page**: `/adpilot/client/src/pages/users.tsx`
- **Auth System**: `/adpilot/server/auth.ts`
- **Database**: `/adpilot/server/db.ts`
- **Schema**: `/adpilot/shared/schema.ts`
- **Fallback Storage**: `/ads_agent/data/access_users.json`

## Security Considerations

✅ **Implemented:**
- Password hashing with scrypt and salt
- Session-based authentication
- Rate limiting on login (10 attempts per 15 minutes)
- HTTPS/secure cookies in production
- Admin-only access to user management endpoints
- Timing-safe password comparison

📋 **Best Practices:**
1. Always change the bootstrap password in production
2. Use strong environment variables for secrets
3. Keep SESSION_SECRET secure and complex
4. Monitor admin access logs
5. Regularly review user access levels
6. Block inactive or unauthorized users

## Troubleshooting

### Users can't log in
- Check if user status is "Active"
- Verify email is spelled correctly
- Ensure password is at least 8 characters

### Can't access user management page
- Verify your user role is "admin"
- Clear browser cache and log out/back in
- Check browser console for errors

### Database errors
- If PostgreSQL is unavailable, system falls back to JSON file storage
- Check DATABASE_URL in your .env
- Ensure postgres container is running: `docker ps`

### Bootstrap admin stuck in file storage
- Delete or edit `/ads_agent/data/access_users.json`
- Ensure DATABASE_URL is set and database is running
- Restart the application

## Frontend Implementation Details

### Components Used
- **Form Fields**: Custom `Field` component with password visibility toggle
- **Select Dropdowns**: Role and Status selections
- **Modal Dialog**: For create/edit operations
- **React Query**: For API calls and caching
- **Toast Notifications**: For user feedback

### State Management
- Uses React hooks for local component state
- React Query for server state and caching
- Auth context for user information

### Validation
- Email must contain "@"
- Name is required and trimmed
- Password minimum 8 characters (only for create, optional for edit)
- Email must be unique
- At least one admin must remain in the system

## Next Steps

1. **Test the UI**: Create a test user and verify login works
2. **Configure Environment**: Update `.env` with production credentials
3. **Add Audit Logging**: Track who created/modified users (optional enhancement)
4. **Email Notifications**: Send welcome emails to new users (optional enhancement)
5. **Two-Factor Auth**: Implement 2FA for enhanced security (future feature)

---

**Last Updated**: 2024
**System**: AdPilot v3
