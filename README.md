# Insurance Analytics Dashboard

A modern, interactive dashboard for analyzing insurance data with A vs Z flight path visualization.

## Features

- **A vs Z Flight Path Chart**: Visualize actual vs expected-to-ultimate claims by cohort
- Interactive data visualization with Plotly.js
- Responsive design (desktop & mobile)
- GitHub Pages deployment ready

## Live Dashboard

The dashboard is automatically deployed to GitHub Pages. Once you push to the `main` or `master` branch, it will be available at:

```
https://[your-username].github.io/insurance-analytics/
```

## Local Setup

1. Clone this repository
2. Open `index.html` in a web browser
3. Data is loaded from `data/analytics.json`

## Deployment to GitHub Pages

### Automatic Deployment (Recommended)

The workflow uses `peaceiris/actions-gh-pages` which automatically handles deployment without requiring pre-configuration.

1. **Enable GitHub Pages** (one-time setup):
   - Go to your repository Settings → Pages
   - Under "Source", select "GitHub Actions"
   - Save the settings

2. **Push your code**:
   ```bash
   git push origin main
   ```

3. **The workflow will automatically deploy** on every push to `main` or `master` branch

4. **Access your dashboard** at:
   ```
   https://[your-username].github.io/insurance-analytics/
   ```

**Note**: The first deployment may take a few minutes. You can check the progress in the "Actions" tab of your repository.

## Structure

```
insurance-analytics/
├── .github/
│   └── workflows/
│       └── deploy.yml     # GitHub Actions deployment workflow
├── css/
│   └── style.css          # Dashboard styles
├── js/
│   └── dashboard.js       # Main dashboard logic & chart rendering
├── data/
│   └── analytics.json     # Data source (cohorts, actuals, E2U)
└── index.html             # Main dashboard page
```

## Data Structure

The `data/analytics.json` file contains:
- **cohorts**: Array of insurance cohorts (origin periods)
- Each cohort has:
  - `cohort_id`: Unique identifier
  - `cohort_name`: Display name
  - `origin_date`: When the cohort originated
  - `expected_to_ultimate`: Initial E2U estimate from origin period
  - `actuals`: Array of actual cumulative claims by development period

## Best Practices Applied

- **Separation of Concerns**: Data loading, rendering, and chart logic are separated
- **Error Handling**: Try-catch blocks with user-friendly error messages
- **DRY Principle**: Reusable constants and configuration
- **Clear Function Naming**: Descriptive names that explain purpose
- **Constants Extraction**: Color palette and configuration at top level

## License

MIT
