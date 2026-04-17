package com.louisfiges.auth.http;

import com.louisfiges.auth.http.exceptions.MfaValidationException;
import com.louisfiges.common.dto.StringErrorResponse;
import dev.samstevens.totp.exceptions.QrGenerationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.lang.NonNull;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * @author Louis Figes 
 */
@ControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    /**
     * Standard error response for generic exceptions.
     * @param ex the exception
     * @return a response entity with  500 internal server error
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<StringErrorResponse> handleGenericException(Exception ex) {
        StringErrorResponse errorDTO = new StringErrorResponse("Internal Server Error");
        return new ResponseEntity<>(errorDTO, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    @ExceptionHandler(MfaValidationException.class)
    public ResponseEntity<StringErrorResponse> handleMfaValidationException(MfaValidationException ex) {
        StringErrorResponse errorDTO = new StringErrorResponse(ex.getMessage());
        return new ResponseEntity<>(errorDTO, HttpStatus.UNAUTHORIZED);
    }

    /**
     * Override the default handler for HttpMessageNotReadableException
     * provided by ResponseEntityExceptionHandler.
     */
    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(
            @NonNull HttpMessageNotReadableException ex,
            @NonNull HttpHeaders headers,
            @NonNull HttpStatusCode status,
            @NonNull WebRequest request
    ) {

        StringErrorResponse errorDTO = new StringErrorResponse("Invalid request, please check API documentation");
        return new ResponseEntity<>(errorDTO, HttpStatus.BAD_REQUEST);
    }
}
