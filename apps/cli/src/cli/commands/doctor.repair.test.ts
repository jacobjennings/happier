import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  runDoctorCommandMock,
  handleServiceRepairCliCommandMock,
} = vi.hoisted(() => ({
  runDoctorCommandMock: vi.fn(async () => {}),
  handleServiceRepairCliCommandMock: vi.fn(async () => undefined),
}));

vi.mock('@/ui/doctor', () => ({
  runDoctorCommand: runDoctorCommandMock,
}));

vi.mock('./service/repair/handleServiceRepairCliCommand', () => ({
  handleServiceRepairCliCommand: handleServiceRepairCliCommandMock,
}));

import { handleDoctorCliCommand } from './doctor';

describe('happier doctor repair', () => {
  afterEach(() => {
    runDoctorCommandMock.mockReset();
    handleServiceRepairCliCommandMock.mockReset();
  });

  // `--help` after `repair` belongs to the repair command, not to doctor's own help page.
  it.each(['--json', '--help'])('delegates doctor repair %s to the canonical service repair flow', async (flag) => {
    await handleDoctorCliCommand({
      args: ['doctor', 'repair', flag],
      rawArgv: ['node', 'happier', 'doctor', 'repair', flag],
      terminalRuntime: null,
    });

    expect(handleServiceRepairCliCommandMock).toHaveBeenCalledWith({
      argv: ['repair', flag],
      commandPath: 'happier doctor',
    });
    expect(runDoctorCommandMock).not.toHaveBeenCalled();
  });

  it('keeps non-repair doctor invocations on the doctor command path', async () => {
    await handleDoctorCliCommand({
      args: ['doctor'],
      rawArgv: ['node', 'happier', 'doctor'],
      terminalRuntime: null,
    });

    expect(runDoctorCommandMock).toHaveBeenCalled();
    expect(handleServiceRepairCliCommandMock).not.toHaveBeenCalled();
  });
});
