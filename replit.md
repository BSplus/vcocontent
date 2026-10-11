# VCO Media Database

## Overview

The VCO Media Database is a comprehensive platform for managing and distributing sim racing media content from events. Built as a full-stack web application, it serves as a central hub for event photography and videography, supporting both VCO-managed content and community creator contributions. The platform features a public-facing gallery with event-based navigation, an advanced search system, and a dual-tier admin system for both VCO administrators and approved content creators.

The application enables users to browse and download media from sim racing events, with support for premium content monetization through a credit-based system. Creators can apply for accounts, manage their own events and media, while maintaining complete separation from VCO-managed content and other creators' work.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- React with TypeScript for type-safe component development
- Vite as the build tool and development server
- Wouter for lightweight client-side routing
- TanStack Query (React Query) for server state management and caching
- shadcn/ui component library built on Radix UI primitives
- Tailwind CSS for styling with custom theming support

**Design Decisions:**
- Component-based architecture with reusable UI elements
- Explicit media-editor analysis can match entry/result references. Automatic photos remain tag-only unless an Admin/gallery owner explicitly enables Photo matching for that event. Opt-in photos use structured recognition and deterministic context/reference captions, with drivers labeled as registered lineups. Enabling alone never processes history; selected batches are capped at 50 and need AI consent. Historical preserved captions need individual replacement consent; manual (including deliberately empty), editorial and imported text remain protected. New Nextcloud filenames carry placeholder provenance. Existing Community context-caption defaults and videos remain unchanged while opt-in is off. Independent publication safety review remains required. Reference sources are private App Storage objects with authenticated owner/Admin access and durable cleanup.
- Analysis completion in the editor must reconcile against effective saved tags, not raw generated tags, preserving suppression and draft removals. Production startup verifies schema readiness read-only and refuses to serve an unmigrated database; no startup DDL is allowed.
- Custom theme system using CSS variables and JSON configuration for brand consistency
- Responsive design optimized for both desktop and mobile viewing

**Click-target conventions:**
- App-owned system copy is English, including API errors and new import status. Preserve user content, proper names, legal wording and historical stored errors. See `docs/system-text-audit.md`.
- Public media search is labeled “Search media”; it searches media metadata, not a separate event catalog.
- “Recent events” and “Creator events” identify event-list destinations; upcoming listings are calendar information, not gallery links.
- “Preview” opens a dialog, “Media details” navigates to the media page, and “Download options” opens the existing quality menu. Download counts are statistics.
- In admin selection mode, thumbnail labels say Select/Deselect; the explicit Preview button still opens a preview.
- Creator media editing stays visible without hover and returns keyboard focus to its opener.
- Focused browser checks: `node --test tests/ui-click-targets.test.mjs`. These use isolated API fixtures without database writes; they verify UI role boundaries, not authenticated backend ownership.
- Client-side search and filtering using Fuse.js for fuzzy matching
- Error boundary implementation for graceful error handling
- Font system using Orbitron for headings, Rajdhani for interactive elements, and Space Grotesk for body text

**Key Features:**
- Event-based media gallery with thumbnail grid layouts
- Advanced search with filtering by caption, photographer, tags, and media type
- Real-time media preview with lightbox functionality
- Bulk media upload with progress tracking
- WebSocket integration for real-time updates
- Stripe integration for credit purchases

### Backend Architecture

**Technology Stack:**
- Node.js with Express.js framework
- TypeScript for type safety across the stack
- Drizzle ORM for database interactions
- Passport.js with local strategy for authentication
- Express-session with in-memory store for session management
- OpenAI API integration for AI-powered content tagging

**Design Decisions:**
- RESTful API design with clear resource-based routing
- Role-based access control (RBAC) with three user types: regular users, creators, and admins
- Session-based authentication with secure cookie handling
- Middleware-based authorization checks for route protection
- Separation of concerns with dedicated modules for auth, storage, and routes

**API Structure:**
- `/api/user` - Authentication and user profile management
- `/api/events` - Event CRUD operations with creator filtering
- `/api/media` - Media item management and retrieval
- `/api/series` - Racing series management
- `/api/stripe` - Payment processing and credit management
- WebSocket endpoint for real-time communication

### Data Storage

**Database:**
- PostgreSQL via Neon serverless with WebSocket connections
- Drizzle ORM for type-safe database queries and migrations
- Schema-first design with Zod validation

**Database Schema:**
- `users` - User accounts with authentication credentials, roles (admin/creator), credit balance, and Stripe customer IDs
- `events` - Event records with metadata, creator associations, premium status, and view tracking
- `series` - Racing series for grouping related events
- `mediaItems` - Individual photos/videos with metadata including caption, photographer, tags, thumbnails, and IPTC data

**Design Rationale:**
- Foreign key relationships maintain referential integrity between events, creators, and media
- Decimal type for credits ensures precise monetary calculations
- Boolean flags for role management enable simple RBAC queries
- Timestamp fields track creation dates for sorting and filtering

### Authentication & Authorization

**Authentication System:**
- Passport.js local strategy with username/password
- Scrypt-based password hashing with salt for security
- Express-session for maintaining user state
- Session persistence using memory store (scalable to Redis)

**Authorization Levels:**
- Public users: Browse and download free content
- Registered users: Purchase and use credits for premium content
- Creators: Manage own events and media, cannot access other creators' content
- Admins: Full platform access including user management and content moderation

**Middleware Implementation:**
- `requireAuth` - Validates user authentication
- `requireAdmin` - Enforces admin-only access
- `requireCreator` - Ensures creator status (pending/approved)
- `requireOwnershipOrAdmin` - Verifies resource ownership or admin privilege

### External Dependencies

**Payment Processing:**
- Stripe for credit purchases and subscription management
- Webhook integration for payment confirmation
- Customer ID storage for recurring billing

**AI Services:**
- OpenAI GPT-4 Vision API for automated image tagging
- Custom prompts for sim racing-specific content categorization
- Predefined tag taxonomy for consistent categorization

**Media Handling:**
- Disk-backed multipart uploads to private App Storage, with shared bounded processing and the limits in `server/media-policy.ts`
- Server-side image conversion and thumbnails; video files use safe poster previews
- Photo download rules and the offline comparison: `docs/image-download-quality.md`.
  Creator originals use server-issued UUIDv8 media keys, never relabel historical v4
  keys; image policy follows the authorized gallery, not the uploader's admin role.
  Exactly two photo objects, fixed decimal budgets 5,000,000 + 100,000 bytes.
  Run the isolated checks with `node scripts/test-image-downloads.mjs` (local PostgreSQL
  tools required); this uses a disposable database and local mocked storage/providers,
  not the connected database. No schema migration is needed for this image change.
- IPTC metadata extraction for professional photo metadata
- Durable AI tag jobs with shared provider concurrency, bounded retries and manual-tag/caption preservation
- Uploaded videos automatically use bounded private-original FFmpeg sampling and timestamped recognition batches; image auto-analysis remains tag-only. Original videos and the existing generic posters are unchanged.
- FFmpeg/FFprobe are declared through `pkgs.ffmpeg`. Video analysis has a 75-second sampling deadline, 8-second tool deadlines, 960px/512KiB frames, at most 12 frames, four-image provider batches, 25-second provider deadlines and 15-second fenced lease renewal.
- Video evidence/checksums, successful batches and known token usage persist in the additive job schema. Apply `migrations/media-process-jobs.sql` through the existing development/post-merge script or approved release schema rollout; production startup only checks readiness.
- Run `npm run test:video-analysis` with the preview worker stopped; browser editor checks run separately with the preview serving. Measurements and live-validation limitations are in `docs/video-analysis-validation.md`.
- Encrypted, expiring Nextcloud manifests for resumable imports; saved files are deduplicated
- Native browser downloads through permission-checked streaming routes; count completed delivery, not authorization
- Additive development/post-merge schema setup; never perform production DDL at application startup or build
- Focused queue tests require serial execution and no competing preview worker on the same database
- Autoscale does not guarantee uninterrupted idle-time processing; see `docs/media-process-review.txt` for measurements and operational limits

**Third-Party UI Components:**
- Radix UI for accessible component primitives
- Framer Motion for animations
- Lucide React for consistent iconography
- React Hook Form with Zod resolver for form validation

**Developer Tools:**
- Replit-specific Vite plugins for development environment integration
- ESBuild for production bundling
- TypeScript compiler for type checking
- Drizzle Kit for database migrations

## Public beta configuration

- `RESEND_API_KEY` belongs in Replit Secrets. Set `RESEND_FROM` to a verified sender email address and `PUBLIC_SITE_URL` to the trusted HTTPS root origin of the environment running this code. No paths, queries or credentials. Never print keys or verification tokens.
- Search visibility: see `docs/search-visibility-launch.md` before public launch or canonical-domain changes. Missing/invalid `PUBLIC_SITE_URL` keeps indexing disabled. Public HTML and segmented image sitemaps reuse current moderation gates; no originals or private account data belong in discovery output. Domain/access changes require operator approval.
- Missing mail configuration or email verification prevents new community publication. Missing managed image-safety configuration prevents new releases and administrative safety approval.
- Development additive setup: `node --import tsx scripts/apply-dev-process-schema.mjs`. Production migration/release requires separate approval; ensure every public reader uses the new visibility and safety gates before enabling beta writes. Do not assume the development and production databases are isolated.
- Historical public images remain unreviewed legacy content. New public image/profile/cover/text versions require the applicable gate. Changing safety prompts/categories requires a safety policy version bump.
- Tests must mock mail and AI, use synthetic images, isolate queue consumers and clean only their own storage objects. Do not send real verification mail during routine tests.