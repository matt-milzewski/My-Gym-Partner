'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true }
});

const WORKOUT_TABLE = process.env.WORKOUT_TABLE;
const EXERCISE_TABLE = process.env.EXERCISE_TABLE;
const OWNER_ID = process.env.OWNER_ID || 'default';
const OWNER_PK = `OWNER#${OWNER_ID}`;

const BASE_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*'
};

exports.handler = async (event) => {
  try {
    const method = event?.requestContext?.http?.method;
    const path = event?.rawPath;

    if (method === 'POST' && path === '/workouts') {
      return await handleCreateWorkout(event);
    }

    if (method === 'GET' && path === '/exercises') {
      return await handleGetExercises();
    }

    if (method === 'GET' && path === '/workouts/latest') {
      return await handleGetLatestWorkout(event);
    }

    if (method === 'GET' && path === '/workouts') {
      return await handleGetWorkoutHistory(event);
    }

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    if (error && error.statusCode) {
      return jsonResponse(error.statusCode, { error: error.message });
    }

    console.error('Unhandled error', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};

async function handleCreateWorkout(event) {
  const body = parseJsonBody(event.body);

  const exerciseName = sanitizeExerciseName(body.exerciseName);
  if (!exerciseName) {
    throw badRequest('exerciseName is required');
  }

  const exerciseNorm = normalizeExerciseName(exerciseName);
  const workoutDate = normalizeWorkoutDate(body.workoutDate);
  const sets = normalizeSets(body.sets);

  const topSet = getTopSet(sets);
  const est1rm = roundTo2(topSet.weight * (1 + topSet.reps / 30));
  const createdAt = Date.now();

  const workoutItem = {
    pk: `${OWNER_PK}#EX#${exerciseNorm}`,
    sk: `DATE#${workoutDate}#TS#${createdAt}`,
    ownerId: OWNER_ID,
    exerciseName,
    exerciseNorm,
    workoutDate,
    createdAt,
    sets,
    derived: {
      topSetWeight: topSet.weight,
      topSetReps: topSet.reps,
      est1rm
    }
  };

  const exerciseItem = {
    pk: OWNER_PK,
    sk: `EX#${exerciseNorm}`,
    exerciseName,
    exerciseNorm,
    updatedAt: createdAt
  };

  await Promise.all([
    ddb.send(
      new PutCommand({
        TableName: WORKOUT_TABLE,
        Item: workoutItem
      })
    ),
    ddb.send(
      new PutCommand({
        TableName: EXERCISE_TABLE,
        Item: exerciseItem
      })
    )
  ]);

  return jsonResponse(201, { item: workoutItem });
}

async function handleGetExercises() {
  const result = await ddb.send(
    new QueryCommand({
      TableName: EXERCISE_TABLE,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: {
        '#pk': 'pk'
      },
      ExpressionAttributeValues: {
        ':pk': OWNER_PK
      }
    })
  );

  const items = (result.Items || [])
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((item) => ({
      exerciseName: item.exerciseName,
      exerciseNorm: item.exerciseNorm,
      updatedAt: item.updatedAt
    }));

  return jsonResponse(200, { items });
}

async function handleGetLatestWorkout(event) {
  const exerciseNorm = getExerciseNormFromQuery(event);
  const items = await queryWorkouts(exerciseNorm, 1);
  const item = items[0] || null;
  return jsonResponse(200, { item });
}

async function handleGetWorkoutHistory(event) {
  const exerciseNorm = getExerciseNormFromQuery(event);
  const requestedLimit = Number.parseInt(event?.queryStringParameters?.limit || '50', 10);
  const limit = Number.isInteger(requestedLimit) ? clamp(requestedLimit, 1, 200) : 50;
  const items = await queryWorkouts(exerciseNorm, limit);
  return jsonResponse(200, { items });
}

async function queryWorkouts(exerciseNorm, limit) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: WORKOUT_TABLE,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: {
        '#pk': 'pk'
      },
      ExpressionAttributeValues: {
        ':pk': `${OWNER_PK}#EX#${exerciseNorm}`
      },
      ScanIndexForward: false,
      Limit: limit
    })
  );

  return result.Items || [];
}

function parseJsonBody(rawBody) {
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch (_) {
    throw badRequest('Request body must be valid JSON');
  }
}

function getExerciseNormFromQuery(event) {
  const exerciseRaw = event?.queryStringParameters?.exercise;
  const exerciseName = sanitizeExerciseName(exerciseRaw);

  if (!exerciseName) {
    throw badRequest('exercise query parameter is required');
  }

  return normalizeExerciseName(exerciseName);
}

function sanitizeExerciseName(name) {
  if (typeof name !== 'string') {
    return '';
  }

  return name.trim().replace(/\s+/g, ' ');
}

function normalizeExerciseName(name) {
  return sanitizeExerciseName(name).toLowerCase();
}

function normalizeWorkoutDate(value) {
  if (value === undefined || value === null || value === '') {
    return new Date().toISOString().slice(0, 10);
  }

  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest('workoutDate must be in YYYY-MM-DD format');
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest('workoutDate is invalid');
  }

  return value;
}

function normalizeSets(sets) {
  if (!Array.isArray(sets) || sets.length < 1 || sets.length > 20) {
    throw badRequest('sets must contain between 1 and 20 entries');
  }

  return sets.map((set, index) => {
    const reps = Number(set?.reps);
    const weight = Number(set?.weight);

    if (!Number.isInteger(reps) || reps < 1 || reps > 200) {
      throw badRequest(`set ${index + 1}: reps must be an integer between 1 and 200`);
    }

    if (!Number.isFinite(weight) || weight < 0 || weight > 2000) {
      throw badRequest(`set ${index + 1}: weight must be a number between 0 and 2000`);
    }

    return {
      setNumber: index + 1,
      reps,
      weight: roundTo2(weight)
    };
  });
}

function getTopSet(sets) {
  return sets.reduce((best, current) => {
    if (current.weight > best.weight) {
      return current;
    }

    if (current.weight === best.weight && current.reps > best.reps) {
      return current;
    }

    return best;
  });
}

function roundTo2(value) {
  return Number(value.toFixed(2));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function badRequest(message) {
  return { statusCode: 400, message };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: BASE_HEADERS,
    body: JSON.stringify(body)
  };
}
