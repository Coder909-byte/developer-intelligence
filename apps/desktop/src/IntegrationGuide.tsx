import { Badge, Card } from '@udi/ui';

export function IntegrationGuide() {
  return (
    <>
      <Card title="How integrations work">
        <p>
          Desktop and VS Code connect to the same local engine. Your registered workspace identifies
          the project; context and engineering findings come from that project's shared state.
        </p>
        <ol className="setup-steps">
          <li>
            <strong>Connect the local engine.</strong>
            <p>
              Start the team's daemon, enter its loopback address and local token above, then select
              or register your workspace.
            </p>
          </li>
          <li>
            <strong>Use the VS Code sidebar.</strong>
            <p>
              Enable the Developer Intelligence extension, open the same workspace and run Set
              Daemon Token. The sidebar retrieves project context and findings through the same
              engine.
            </p>
          </li>
          <li>
            <strong>Connect an MCP-compatible host when available.</strong>
            <p>
              A supported host calls the team's MCP gateway with an explicit project ID. It can
              retrieve the stored project context once gateway setup and host compatibility are
              verified. Context persistence is already available in the local engine.
            </p>
          </li>
          <li>
            <strong>Inspect engineering evidence.</strong>
            <p>
              Tool adapters will record actual validation results. Review the expected and observed
              values and source files before making a correction.
            </p>
          </li>
        </ol>
        <div className="notice">
          Agents receive explicitly shared project context. Private conversations and hidden agent
          reasoning are not automatically captured.
        </div>
      </Card>
      <Card title="Apps & open-source tools">
        <div className="table-scroll">
          <table className="integration-table">
            <thead>
              <tr>
                <th scope="col">Application / tool</th>
                <th scope="col">Integration path</th>
                <th scope="col">Current availability</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Desktop & VS Code</th>
                <td>Local daemon, shared workspace and token</td>
                <td>
                  <Badge>Persisted project data wired</Badge>
                </td>
              </tr>
              <tr>
                <th scope="row">MCP-compatible agents</th>
                <td>Scoped tools through the team's MCP gateway</td>
                <td>
                  <Badge tone="warning">Gateway setup & host verification required</Badge>
                </td>
              </tr>
              <tr>
                <th scope="row">KiCad</th>
                <td>
                  Exported netlist or explicitly labeled normalized fixture, compared with firmware
                  pin mappings
                </td>
                <td>
                  <Badge tone="warning">Engineering service required</Badge>
                </td>
              </tr>
              <tr>
                <th scope="row">PlatformIO</th>
                <td>Approved build runner records real output and exit code</td>
                <td>
                  <Badge tone="warning">Build execution service required</Badge>
                </td>
              </tr>
              <tr>
                <th scope="row">Icarus Verilog</th>
                <td>Optional RTL compilation and testbench runner</td>
                <td>
                  <Badge>Planned extension</Badge>
                </td>
              </tr>
              <tr>
                <th scope="row">Serial / IoT devices</th>
                <td>Opt-in port connection and telemetry monitoring</td>
                <td>
                  <Badge>Monitoring API required</Badge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          Compatibility must be verified for each host and tool version. This frontend does not
          configure arbitrary applications, flash firmware, control actuators or certify electrical
          safety.
        </p>
      </Card>
    </>
  );
}
