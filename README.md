# SnapSort

A very opinionated solution for a very personal problem of organizing a photos/videos library. SnapSort helps you
(read: me) organize media files (images/videos) and edit metadata.

## Table of Contents

- [Features](#features)
  - [Metadata Management](#metadata-management)
  - [Library Organization](#library-organization)
- [Setup and Usage](#setup-and-usage)
- [Contribution and Development](#contribution-and-development)
  - [Running a development instance](#running-a-development-instance)
  - [Project structure](#project-structure)
- [Future Improvements](#future-improvements)

## Features

### Metadata Management

- **Create Keywords**: Create different types of keywords (Album, Location, Person, Animal, Group, or Other) which can
  be used to tag files.
- **Edit Metadata**: Modify capture date and time, title/descriptions, GPS data, and keywords for your media files.
- **Batch Editing**: Apply metadata changes to multiple files at once, saving time and ensuring consistency.
- **View Metadata**: View all metadata associated with your library files.
- **EXIF Data Export**: Export metadata from your library files for backup or analysis.

### Library Organization

Media library is organized in a "Year / Month / Day" hierarchy. The Day folder may have a `- Keyword` suffix
depending on whether any of the files within that folder contains a keyword which can be used as a folder label.

The files use the following naming convention: `TAG-YYYYMMDD-INDEX`<br/>
`TAG` will be `IMG` or `VID` depending on the type of the media. A special keyword `Edit` can be added to the file to
overwrite `TAG` to be `EDT`.

```
library/
    |- 2025/
        |- 01 - January/
            |- 01/
                |- IMG-20250101-000.jpg
                |- VID-20250101-000.mp4
            |- 02 - Birthday/
                |- EDT-20250102-000.jpg
                |- IMG-20250102-000.jpg
                |- IMG-20250102-001.jpg
```

## Setup and Usage

**Prerequisites:**

- [Docker](https://www.docker.com/)
- [Ability to use Docker](https://www.youtube.com/watch?v=DQdB7wFEygo)

**Docker Compose configuration:**

```yaml
services:
  snapsort:
    image: bhatushar/snapsort
    ports:
      - '3990:3990'
    volumes:
      - '/app-data:/app/data'
      - '/library:/app/library'
    environment:
      TZ: Asia/Calcutta
    restart: unless-stopped
```

`/app-data` is where SnapSort will store its internal files like the database, user-uploaded media, and thumbnails.<br/>
`/library` is where your media will go once processed by SnapSort.<br/>

Run the container with `docker compose up -d` and you should be able to access the website on `localhost:3990`.

When you first launch the application, it will ask you to create a login password. SnapSort currently doesn't support
multiple users.<br/>
After logging in, you'll land on the homepage where you can upload new media files for processing. You can edit the date
and time information, add titles to your media, tag them with keywords... Oh wait, you can't use keywords?

That's because you need to create the keywords first!<br/>
Go to Settings > Manage Keywords. On the top-right, there will be an option to add keywords.<br/>
Here, you can set the name of the keyword, its type/category, and whether to use it to label folders.<br/>
Now you can go back and start tagging your files.

Whatever changes you make will not persist until you save them. When you click the 'Save' button, you get two options:

1. _Apply Changes_: This will only store your changes in SnapSort's internal database. Your files will remain intact.
   This is useful if you want to come back in the future and revise your changes.
2. _Move to Library_: This is the final step. It will apply your changes to your files and move them to the library.

## Contribution and Development

This project is developed using the SvelteKit framework with TypeScript support. It uses a locally hosted SQLite
database, and the DB connection is managed by Drizzle.<br/>
Internally, it relies on [ExifTool](https://exiftool.org/) (for reading/writing metadata) and
[FFmpeg](https://ffmpeg.org/) (for generating thumbnails for videos).

### Running a development instance

Set up the project:

```bash
git clone https://github.com/bhatushar/snapsort.git
cd snapsort
pnpm install
```

Create an `.env.development` file:

```dotenv
# Database credentials
DATABASE_URL="file:/path/to/db.sqlite3"

# Path to external binaries
EXIFTOOL_PATH="/path/to/exiftool"
FFMPEG_PATH="/path/toffmpeg"

# Path to data storage
FILE_UPLOAD_DIR="/path/to/uploaded-files"
LIBRARY_ROOT_DIR="/path/to/library"
```

Run database migrations and fire up the server:

```bash
pnpm db:migrate:dev
pnpm dev
```

If you want to run a production server, you need to create an `.env.production` file and run `pnpm start`.

### Project structure

- `src/`:
  - `lib/`:
    - `components/`: Contains various UI components which can be imported in Svelte Pages
    - `server/`: Server-only code
      - `db/`:
        - `index.ts`: Manages database connection and exposes a wrapper for all database interactions
        - `schema.ts`: Defines the database structure which Drizzle uses to create migrations
      - `exiftool-wrapper.ts`: Manages all interactions with ExifTool
      - `file-manager.ts`: Handles all operations for uploaded files (create, rename, copy, delete)
      - `validation-schema.ts`: Zod schemas to validate external input
  - `routes/`: SvelteKit routes
    - `api/`
      - `export-exif/+server.ts`: Endpoint for exporting Exif data for all library files
      - `thumbnail/[file_id]/+server.ts`: Endpoint for fetching thumbnail using the file ID

## Future Improvements

- Google Photos Integration: Currently, I use Google Photos as a cloud backup (I know it's not a real backup, hush!).
  Once the files are committed to the library, they should also be uploaded to Google Photos. In the distant future, I
  might look into extending this to multiple cloud providers.
- Add Tests: Now that the MVP is developed, a robust testing suite is needed. My photos are too precious to expose to
  untested code.
- Backup/Restore: It's "technically" possible by manually cloning the app-data folder... But perhaps something more
  robust.
- Multi-user Support: The more, the merrier!
- Modify/Delete Existing Keywords: So far, I haven't faced a need to update a Keyword once it's created. Nonetheless, it
  is a useful feature.
- Custom File Formats: I know I said it's opinionated, but it would still be nice to let users decide how they want
  their media to be organized.
