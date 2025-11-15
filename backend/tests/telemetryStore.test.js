const telemetryStore = require('../services/telemetryStore');

describe('telemetryStore', () => {
    afterEach(() => {
        telemetryStore.__dangerousReset();
    });

    it('records task durations and job status timeline', () => {
        telemetryStore.recordJobStatus('job-123', 'queued', { fileCount: 2 });
        telemetryStore.recordTaskStart('job-123', 'extraction', { fileCount: 2 });
        telemetryStore.recordTaskEnd('job-123', 'extraction', 'completed', { resultKeys: ['dataQualityReport'] });
        telemetryStore.recordJobStatus('job-123', 'completed');

        const snapshot = telemetryStore.getJobTelemetry('job-123');
        expect(snapshot).toBeTruthy();
        expect(snapshot.statusHistory).toHaveLength(2);
        expect(snapshot.taskStats.extraction).toBeDefined();
        expect(snapshot.taskStats.extraction.runs).toBe(1);
        expect(snapshot.timeline.some(event => event.type === 'task:start')).toBe(true);
        expect(snapshot.timeline.some(event => event.type === 'task:end')).toBe(true);
    });

    it('summarizes tracked jobs in the overview', () => {
        telemetryStore.recordJobStatus('job-a', 'queued');
        telemetryStore.recordTaskStart('job-a', 'extraction');
        telemetryStore.recordTaskEnd('job-a', 'extraction', 'failed', { error: 'broken' });
        telemetryStore.recordJobStatus('job-a', 'failed');

        const overview = telemetryStore.getOverview();
        expect(overview.totals.trackedJobs).toBeGreaterThan(0);
        expect(overview.totals.failed).toBeGreaterThanOrEqual(1);
        expect(overview.taskStats.extraction).toBeDefined();
    });
});
