/*
 * TM4C123 Simulator test fixture — link-error.c
 *
 * Negative fixture: compiles, but calls a function that is never defined,
 * so the link step must fail.
 */

void missing_function(void);

int main(void)
{
    missing_function();
    for (;;)
    {
    }
}
