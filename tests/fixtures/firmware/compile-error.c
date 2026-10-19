/*
 * TM4C123 Simulator test fixture — compile-error.c
 *
 * Negative fixture: a C syntax error (missing semicolon) and an undeclared
 * identifier. The pipeline must report real GCC diagnostics and must not
 * produce or run firmware.
 */

#include <stdint.h>

int main(void)
{
    uint32_t value = 1u
    value = undeclared_identifier;
    for (;;)
    {
    }
}
