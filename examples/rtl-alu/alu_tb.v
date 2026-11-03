// Testbench for 4-bit ALU - Passing verification
`timescale 1ns / 1ps

module alu_tb;
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
        $display("START_ALU_TESTBENCH");

        // Test 1: ADD 3 + 2 = 5
        a = 4'd3; b = 4'd2; op = 2'b00; #10;
        if (result !== 4'd5 || zero !== 1'b0) begin
            $display("ASSERTION FAILED: ADD 3 + 2 expected 5, got %d", result);
            $fatal(1);
        end

        // Test 2: SUB 5 - 5 = 0 (zero flag set)
        a = 4'd5; b = 4'd5; op = 2'b01; #10;
        if (result !== 4'd0 || zero !== 1'b1) begin
            $display("ASSERTION FAILED: SUB 5 - 5 expected 0 with zero flag, got %d", result);
            $fatal(1);
        end

        // Test 3: AND 4'b1100 & 4'b1010 = 4'b1000 (8)
        a = 4'b1100; b = 4'b1010; op = 2'b10; #10;
        if (result !== 4'b1000) begin
            $display("ASSERTION FAILED: AND expected 8, got %d", result);
            $fatal(1);
        end

        // Test 4: OR 4'b1100 | 4'b0011 = 4'b1111 (15)
        a = 4'b1100; b = 4'b0011; op = 2'b11; #10;
        if (result !== 4'b1111) begin
            $display("ASSERTION FAILED: OR expected 15, got %d", result);
            $fatal(1);
        end

        $display("ALL 4 ALU TESTS PASSED");
        $finish;
    end
endmodule
