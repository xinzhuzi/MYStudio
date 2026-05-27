// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * RunningHub API Test Endpoint
 * Tests the connection to RunningHub API using a simple query
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey, baseUrl } = body;

    if (!apiKey || apiKey.trim() === '') {
      return NextResponse.json(
        { error: 'API Key is required' },
        { status: 400 }
      );
    }
    if (!baseUrl || baseUrl.trim() === '') {
      return NextResponse.json(
        { error: 'Base URL is required' },
        { status: 400 }
      );
    }

    // Test connection by querying a known task (or checking auth)
    // Since we don't have a specific "test" endpoint, we'll try to query with a dummy taskId
    // and check if we get a proper auth response
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
    const testUrl = `${normalizedBaseUrl}/query`;
    
    const response = await fetch(testUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        taskId: 'test-connection-check',
      }),
    });

    // If we get 401/403, the key is invalid
    if (response.status === 401 || response.status === 403) {
      return NextResponse.json(
        { error: 'Invalid API Key or unauthorized' },
        { status: 401 }
      );
    }

    // If we get 404 or 400, the key is valid but the taskId doesn't exist (expected)
    if (response.status === 404 || response.status === 400) {
      return NextResponse.json(
        { success: true, message: 'API Key is valid' },
        { status: 200 }
      );
    }

    // Any 2xx response means connection is successful
    if (response.ok) {
      return NextResponse.json(
        { success: true, message: 'Connection successful' },
        { status: 200 }
      );
    }

    // Other errors
    const errorText = await response.text();
    return NextResponse.json(
      { 
        error: `API returned status ${response.status}`,
        details: errorText 
      },
      { status: response.status }
    );

  } catch (error) {
    console.error('[runninghub-test] Error:', error);
    return NextResponse.json(
      { error: 'Failed to test RunningHub connection' },
      { status: 500 }
    );
  }
}
