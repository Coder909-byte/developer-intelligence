// Testbench for 4-bit ALU - Intentional failure case for testing diagnostic capture
`timescale 1ns / 1ps

module alu_failing_tb;
    reg  [3:0] a;
    reg  [3:0] b;
    reg  [1:0] op;
    wire [3:0] result;
    wire       zero;

    alu uut (
        .a(a),
        .b(b),
        .op(op),
        .result(result),
        .zero(zero)
    );

    initial begin
        $display("START_ALU_FAILING_TESTBENCH");
        // Incorrect expectation: 3 + 2 is asserted to equal 99
        a = 4'd3; b = 4'd2; op = 2'b00; #10;
        if (result !== 4'd9) begin
            $display("ASSERTION FAILED: ADD 3 + 2 expected 9, got %d", result);
            $fatal(1);
        end
        $finish;
    end
endmodule
