# SnapSort

A very opinionated solution for a personal problem of organizing a photos/videos library. SnapSort helps you organize
media files (images/videos) and edit metadata.

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

The files follow the following naming convention: `TYPE-YYYYMMDD-INDEX`

```
library/
    |- 2025/
        |- 01 - January/
            |- 01/
                |- IMG-20250101-000.jpg
                |- VID-20250101-000.mp4
            |- 02 - Birthday/
                |- IMG-20250102-000.jpg
                |- IMG-20250102-001.jpg
```

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [PNPM](https://pnpm.io/) package manager
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/) (for PostgreSQL database)
- [ExifTool](https://exiftool.org/) (for metadata manipulation)
- [FFmpeg](https://ffmpeg.org/) (for video processing)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/bhatushar/snap-sort.git
   cd snap-sort
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Create a `.env` file based on the provided `.env.example`:

   ```bash
   cp .env.example .env
   ```

4. Edit the `.env` file to configure your environment:

   - Set database credentials
   - Configure paths to ExifTool and FFmpeg
   - Set file storage directories

5. Start the PostgreSQL database using Docker:

   ```bash
   pnpm db:start
   ```

6. Initialize the database:
   ```bash
   pnpm db:push
   ```

## Running the Application

### Development Mode

Run the application in development mode:

```bash
pnpm dev
```

To make the development server accessible on your local network:

```bash
pnpm dev-network
```

### Production Mode

Build the application for production:

```bash
pnpm build
```

Preview the production build:

```bash
pnpm preview
```

Run the production server:

```bash
node build
```

## Database Management

- Push schema changes to the database:

  ```bash
  pnpm db:push
  ```

- Create migrations:

  ```bash
  pnpm db:migrate
  ```

- Open Drizzle Studio to manage database:
  ```bash
  pnpm db:studio
  ```

## Project Structure

- `/src`: Source code
  - `/lib`: Library code
    - `/server`: Server-side code
      - `/db`: Database models and operations
  - `/routes`: SvelteKit routes
- `/static`: Static assets

## Configuration

The application requires several environment variables to be set in the `.env` file:

### Database Configuration

```
DATABASE_URL=postgresql://root:mysecretpassword@localhost:5432/snapsort
POSTGRES_USER=root
POSTGRES_PASSWORD=mysecretpassword
```

### External Tools

```
EXIFTOOL_PATH="/path/to/exiftool"
FFMPEG_PATH="/path/to/ffmpeg"
```

### File Storage

```
FILE_UPLOAD_DIR="/path/to/uploaded-files"
LIBRARY_ROOT_DIR="/path/to/library"
```

## Usage

1. Start the application and navigate to the web interface
2. Create new keywords
3. Upload your media files
4. Edit metadata as needed (date/time, description, GPS data, keywords)
5. Apply the changes to temporarily modify the queued files
6. Move files to the library to permanently save files
7. Export metadata when needed for backup
