# ValuRoad

ValuRoad is a web application for building structure valuation estimates. It allows users to create, manage, and share valuation projects, including custom DSR (Design Specification Record) catalogs and PDF template management.

## Features

- **Project Management**: Create, edit, and delete valuation projects.
- **Sharing**: Share projects with other users via email.
- **DSR Catalog**: Manage local and global DSR items for quick valuation entries.
- **PDF Export**: Generate valuation reports based on customizable templates.
- **Firebase Integration**: Real-time data sync and authentication.
- **Local Backups**: Automatic local snapshots during development.

## Tech Stack

- **Frontend**: Vite + Vanilla JavaScript / React (depending on actual usage, looks like Vanilla/Vite)
- **Backend**: Firebase (Firestore, Authentication)
- **Styling**: Vanilla CSS

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/valuroad.git
   cd valuroad
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory and add your Firebase configuration:
   ```env
   VITE_FIREBASE_API_KEY=your_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
   VITE_FIREBASE_APP_ID=your_app_id
   VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
   ```

### Development

Run the development server:
```bash
npm run dev
```

### Build

Build the project for production:
```bash
npm run build
```

## Deployment

The project is configured for easy deployment. You can deploy the `dist` folder to any static hosting service like GitHub Pages, Vercel, or Netlify.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
