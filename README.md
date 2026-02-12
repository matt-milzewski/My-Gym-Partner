# Gym Workout Tracker

Tiny single-user workout tracker using low-cost AWS serverless components.

## Stack
- Frontend: static HTML/CSS/JS on S3 behind CloudFront
- API: API Gateway HTTP API -> single Lambda (Node.js 20)
- Data: DynamoDB (`PAY_PER_REQUEST`) tables:
  - `WorkoutLogs`
  - `Exercises`
- IaC: CloudFormation only (`infra/main.yml`)
- CI/CD: GitHub Actions with AWS access key secrets
- Region: `ap-southeast-2`

## Repository layout
- `infra/main.yml` - app infrastructure
- `infra/bootstrap.yml` - optional OIDC bootstrap template
- `backend/src/handler.js` - Lambda API handler
- `frontend/index.html` - UI
- `frontend/styles.css` - UI styles
- `frontend/app.js` - UI behavior + API calls
- `.github/workflows/deploy.yml` - automated deploy

Set these GitHub repository secrets:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION` = `ap-southeast-2`

The workflow deploys CloudFormation stack `my-gym-partner` by default.

## Deploy
Push to `main` or `master` (or run workflow manually). Workflow steps:
1. `npm ci` + build backend zip
2. upload backend zip to deploy artifacts bucket
3. deploy `infra/main.yml` via CloudFormation
4. read stack outputs (`SiteBucketName`, `ApiBaseUrl`, `CloudFrontDistributionId`)
5. generate `frontend/config.json` with `ApiBaseUrl`
6. sync `frontend/` to S3
7. invalidate CloudFront (`/*`)

After deploy, fetch CloudFront URL:
```bash
aws cloudformation describe-stacks \
  --stack-name my-gym-partner \
  --region ap-southeast-2 \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue | [0]" \
  --output text
```

## API endpoints
- `POST /workouts`
- `GET /exercises`
- `GET /workouts/latest?exercise=...`
- `GET /workouts?exercise=...&limit=50`

Validation and derived fields are handled in Lambda.

## Local run (frontend only)
1. Put your API URL in `frontend/config.json`:
```json
{
  "apiBaseUrl": "https://YOUR_API_ID.execute-api.ap-southeast-2.amazonaws.com"
}
```
2. Serve frontend locally:
```bash
cd frontend
python3 -m http.server 8080
```
3. Open `http://localhost:8080`
